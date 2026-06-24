#!/bin/bash
export DOCKER_HOST=unix:///var/run/docker.sock

echo "Waiting for Docker daemon..."
for i in {1..60}; do
    if docker info >/dev/null 2>&1; then
        echo "Docker daemon ready"
        break
    fi
    sleep 1
done

# Create network if not exists
if ! docker network inspect bender_default >/dev/null 2>&1; then
    echo "Creating network..."
    docker network create bender_default
fi

# Generate self-signed SSL certificate if not exists
SSL_DIR=/app/ssl
if [ ! -f "$SSL_DIR/server.crt" ]; then
    echo "Generating self-signed SSL certificate..."
    mkdir -p "$SSL_DIR"
    # Generate certificate valid for localhost and any IP
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$SSL_DIR/server.key" \
        -out "$SSL_DIR/server.crt" \
        -subj "/CN=bender" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0"
    echo "SSL certificate generated"
fi

# Rebuild the inner bender-claude image when the harness image's
# build-id changes (i.e. the harness was rebuilt — which is the only time
# the /app/claude-image/Dockerfile could have been updated) OR when the
# image is missing. This keeps the per-project base in sync with Dockerfile
# edits without manual docker rmi.
IMAGE_BUILD_ID=$(cat /app/.build-id 2>/dev/null || echo "unknown")
STORED_BUILD_ID=$(cat /data/.image-build-id 2>/dev/null || echo "none")
BUILD_ID_CHANGED=0
[ "$IMAGE_BUILD_ID" != "$STORED_BUILD_ID" ] && BUILD_ID_CHANGED=1

if [ "$BUILD_ID_CHANGED" = "1" ] || ! docker image inspect bender-claude >/dev/null 2>&1; then
    if [ "$BUILD_ID_CHANGED" = "1" ]; then
        echo "Harness build-id changed ($STORED_BUILD_ID → $IMAGE_BUILD_ID) — rebuilding claude image"
        docker rmi bender-claude 2>/dev/null || true
    else
        echo "Building Claude image..."
    fi
    docker build -t bender-claude /app/claude-image/
    echo "Claude image built"
fi

if [ "$BUILD_ID_CHANGED" = "1" ]; then
    echo "$IMAGE_BUILD_ID" > /data/.image-build-id
fi

API_SRC=/app/api-service
PORTAL_HTML=/app/html

# Start or reload nginx container on the network
if ! docker ps -q -f name=bender-nginx | grep -q .; then
    echo "Starting nginx container..."
    docker rm -f bender-nginx 2>/dev/null || true
    docker run -d \
        --name bender-nginx \
        --network bender_default \
        -p 80:80 \
        -p 443:443 \
        -v $PORTAL_HTML:/usr/share/nginx/html:ro \
        -v /app/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
        -v /app/ssl:/etc/nginx/ssl:ro \
        nginx:alpine
    echo "Nginx started"
else
    echo "Reloading nginx config..."
    docker exec bender-nginx nginx -s reload 2>/dev/null || true
    echo "Nginx reloaded"
fi

# Try to load v4l2loopback for webcam relay (requires module on host kernel)
# The module may already be loaded at an unpredictable device number
if ! lsmod | grep -q v4l2loopback; then
    modprobe v4l2loopback video_nr=10 card_label="Bender_Webcam" 2>/dev/null && \
        echo "v4l2loopback loaded" || \
        echo "WARN: v4l2loopback not available — webcam relay disabled"
fi

# Find the actual v4l2loopback device (may be at any video number)
V4L2_DEV=""
for d in /sys/class/video4linux/video*; do
    [ -f "$d/name" ] || continue
    if grep -qi "dummy\|loopback\|harness" "$d/name" 2>/dev/null; then
        DEV_NUM=$(basename "$d" | sed 's/video//')
        V4L2_DEV="/dev/video$DEV_NUM"
        [ ! -e "$V4L2_DEV" ] && mknod "$V4L2_DEV" c 81 "$DEV_NUM"
        echo "v4l2loopback device at $V4L2_DEV"
        if command -v v4l2-ctl >/dev/null 2>&1; then
            v4l2-ctl -d "$V4L2_DEV" -c keep_format=1 2>/dev/null
            v4l2-ctl -d "$V4L2_DEV" --set-fmt-video-out=width=1280,height=720,pixelformat=YU12 2>/dev/null
        fi
        break
    fi
done

# Build LD_PRELOAD hook that hides VIDEO_OUTPUT from v4l2loopback QUERYCAP
# so Chrome enumerates the device as a camera input
BROWSER_PROFILE=/data/browser-profile
mkdir -p "$BROWSER_PROFILE"
if [ -n "$V4L2_DEV" ] && [ ! -f "$BROWSER_PROFILE/v4l2_caps_hook.so" ]; then
    echo "Building v4l2 caps hook..."
    cat > /tmp/v4l2_caps_hook.c <<'HOOKC'
#define _GNU_SOURCE
#include <stddef.h>
#include <stdarg.h>
#include <dlfcn.h>
#include <linux/videodev2.h>
typedef int (*ioctl_fn)(int, unsigned long, ...);
static ioctl_fn real_ioctl = NULL;
int ioctl(int fd, unsigned long request, ...) {
    va_list ap;
    va_start(ap, request);
    void *arg = va_arg(ap, void *);
    va_end(ap);
    if (!real_ioctl)
        real_ioctl = (ioctl_fn)dlsym(RTLD_NEXT, "ioctl");
    int ret = real_ioctl(fd, request, arg);
    if (request == VIDIOC_QUERYCAP && ret == 0 && arg) {
        struct v4l2_capability *cap = (struct v4l2_capability *)arg;
        cap->capabilities &= ~(V4L2_CAP_VIDEO_OUTPUT | V4L2_CAP_VIDEO_OUTPUT_MPLANE);
        if (cap->capabilities & V4L2_CAP_DEVICE_CAPS)
            cap->device_caps &= ~(V4L2_CAP_VIDEO_OUTPUT | V4L2_CAP_VIDEO_OUTPUT_MPLANE);
    }
    return ret;
}
HOOKC
    docker run --rm \
        -v /tmp/v4l2_caps_hook.c:/tmp/v4l2_caps_hook.c:ro \
        -v "$BROWSER_PROFILE":/out \
        debian:trixie-slim bash -c "
            apt-get update -qq && apt-get install -y -qq gcc linux-libc-dev >/dev/null 2>&1
            gcc -shared -fPIC -o /out/v4l2_caps_hook.so /tmp/v4l2_caps_hook.c -ldl 2>&1
        " && echo "v4l2 caps hook built" || echo "WARN: v4l2 caps hook build failed"
fi

# Chrome managed policy: force-install Bitwarden from Chrome Web Store
# linuxserver containers run scripts from /config/custom-cont-init.d/ on boot
mkdir -p "$BROWSER_PROFILE/custom-cont-init.d"
cat > "$BROWSER_PROFILE/custom-cont-init.d/setup-extensions.sh" <<'INITSCRIPT'
#!/bin/bash
mkdir -p /etc/chromium/policies/managed

# Bitwarden auto-install + media permissions
cat > /etc/chromium/policies/managed/policies.json <<'JSON'
{
  "ExtensionInstallForcelist": [
    "nngceckbapebfimnlniiiahkandclblb;https://clients2.google.com/service/update2/crx"
  ],
  "VideoCaptureAllowed": true,
  "VideoCaptureAllowedUrls": ["https://*"]
}
JSON
rm -f /etc/chromium/policies/managed/extensions.json

# Webcam relay: wrap chromium binary with LD_PRELOAD hook and D-Bus session
CHROMIUM=/usr/lib/chromium/chromium
if [ -f /config/v4l2_caps_hook.so ] && [ ! -f "${CHROMIUM}.real" ]; then
  mv "$CHROMIUM" "${CHROMIUM}.real"
  cat > "$CHROMIUM" <<'CWRAP'
#!/bin/sh
# Strip Selkies fake-udev from LD_PRELOAD so real libudev enumerates V4L2 cameras
LD_PRELOAD=$(echo "$LD_PRELOAD" | tr ':' '\n' | grep -v 'libudev.*fake' | tr '\n' ':' | sed 's/:$//')
if [ -f /config/v4l2_caps_hook.so ]; then
  LD_PRELOAD="${LD_PRELOAD:+$LD_PRELOAD:}/config/v4l2_caps_hook.so"
fi
export LD_PRELOAD
# Set D-Bus session for Camera Portal access
if [ -f /config/.XDG/dbus-session-addr ]; then
  export DBUS_SESSION_BUS_ADDRESS="$(cat /config/.XDG/dbus-session-addr)"
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/config/.XDG}"
exec /usr/lib/chromium/chromium.real "$@"
CWRAP
  chmod +x "$CHROMIUM"
fi

# Merge WebRtcPipeWireCamera into Wayland's --enable-features to avoid duplicate flags
for f in /defaults/autostart_wayland /config/.config/labwc/autostart; do
  [ -f "$f" ] && ! grep -q 'WebRtcPipeWireCamera' "$f" && sed -i 's/--enable-features=UseOzonePlatform\b/--enable-features=UseOzonePlatform,WebRtcPipeWireCamera/' "$f"
done

# Webcam relay: start D-Bus session, PipeWire, and Camera Portal backend
if [ -e /dev/video10 ] || [ -e /dev/video0 ]; then
  # Ensure abc user can access the video device
  usermod -aG video abc 2>/dev/null || true

  # Install runtime dependencies
  if ! command -v pipewire >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq pipewire wireplumber \
      xdg-desktop-portal python3-dbus python3-gi gir1.2-glib-2.0 >/dev/null 2>&1
  fi

  # Portal configuration files
  mkdir -p /usr/share/xdg-desktop-portal/portals
  cat > /usr/share/xdg-desktop-portal/portals/harness-camera.portal <<'PORTALFILE'
[portal]
DBusName=org.freedesktop.impl.portal.Camera
Interfaces=org.freedesktop.impl.portal.Camera;org.freedesktop.impl.portal.Access
UseIn=*
PORTALFILE

  mkdir -p /config/.config/xdg-desktop-portal
  cat > /config/.config/xdg-desktop-portal/portals.conf <<'PORTALCFG'
[preferred]
default=harness-camera
PORTALCFG

  mkdir -p /usr/share/dbus-1/services
  cat > /usr/share/dbus-1/services/org.freedesktop.impl.portal.Camera.service <<'SVCFILE'
[D-BUS Service]
Name=org.freedesktop.impl.portal.Camera
Exec=/usr/bin/python3 /config/camera-portal-backend.py
SVCFILE

  XDG_DIR="/config/.XDG"
  mkdir -p "$XDG_DIR"
  chown abc:abc "$XDG_DIR"

  # Camera pipeline script — launched from labwc autostart so processes
  # persist for the lifetime of the desktop session (not the init script)
  cat > /config/camera-pipeline.sh <<'CAMPIPE'
#!/bin/bash
export XDG_RUNTIME_DIR=/config/.XDG

# Clean stale files from previous boot
rm -f "$XDG_RUNTIME_DIR/dbus-session-addr" "$XDG_RUNTIME_DIR/dbus-session.pid"
rm -f "$XDG_RUNTIME_DIR/pipewire-0" "$XDG_RUNTIME_DIR/pipewire-0-manager" "$XDG_RUNTIME_DIR/pipewire-0.lock"
rm -f /tmp/camera-portal.log /tmp/xdg-portal.log

# Start a dedicated D-Bus session for the camera pipeline
eval $(dbus-launch --sh-syntax)
echo "$DBUS_SESSION_BUS_ADDRESS" > "$XDG_RUNTIME_DIR/dbus-session-addr"
echo "$DBUS_SESSION_BUS_PID" > "$XDG_RUNTIME_DIR/dbus-session.pid"

# PipeWire + WirePlumber (with v4l2 caps hook for OUTPUT→CAPTURE rewrite)
export LD_PRELOAD=/config/v4l2_caps_hook.so
pipewire &
sleep 1
wireplumber &
sleep 2
unset LD_PRELOAD

# Camera portal backend (Python D-Bus service)
python3 /config/camera-portal-backend.py > /tmp/camera-portal.log 2>&1 &
sleep 1

# xdg-desktop-portal (connects Chrome to PipeWire via our backend)
/usr/libexec/xdg-desktop-portal > /tmp/xdg-portal.log 2>&1 &

# Keep running so labwc doesn't consider us exited
wait
CAMPIPE
  chmod +x /config/camera-pipeline.sh

  # Inject camera pipeline into labwc autostart (runs before Chrome, as user abc)
  for f in /defaults/autostart_wayland /config/.config/labwc/autostart; do
    if [ -f "$f" ] && ! grep -q 'camera-pipeline' "$f"; then
      sed -i '1a /config/camera-pipeline.sh &\nsleep 3' "$f"
    fi
  done
fi
INITSCRIPT
chmod +x "$BROWSER_PROFILE/custom-cont-init.d/setup-extensions.sh"
rm -f "$BROWSER_PROFILE/custom-cont-init.d/install-policies.sh"

# Camera Portal backend: Python D-Bus service that implements org.freedesktop.impl.portal.Camera
cat > "$BROWSER_PROFILE/camera-portal-backend.py" <<'CAMPY'
#!/usr/bin/env python3
import os, socket, dbus, dbus.service, dbus.mainloop.glib
from gi.repository import GLib

class CameraPortalBackend(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, "/org/freedesktop/portal/desktop")
        self._pw = os.environ.get("XDG_RUNTIME_DIR", "/config/.XDG") + "/pipewire-0"

    @dbus.service.method("org.freedesktop.impl.portal.Camera",
        in_signature="osa{sv}", out_signature="ua{sv}")
    def AccessCamera(self, handle, app_id, options):
        return (dbus.UInt32(0), {})

    @dbus.service.method("org.freedesktop.impl.portal.Camera",
        in_signature="a{sv}", out_signature="h")
    def OpenPipeWireRemote(self, options):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(self._pw)
        fd = os.dup(sock.fileno())
        sock.detach()
        return dbus.types.UnixFd(fd)

    @dbus.service.method("org.freedesktop.impl.portal.Access",
        in_signature="osssssa{sv}", out_signature="ua{sv}")
    def AccessDialog(self, handle, app_id, parent_window, title, subtitle, body, options):
        return (dbus.UInt32(0), {})

if __name__ == "__main__":
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    addr_file = os.environ.get("XDG_RUNTIME_DIR", "/config/.XDG") + "/dbus-session-addr"
    if not os.environ.get("DBUS_SESSION_BUS_ADDRESS") and os.path.exists(addr_file):
        os.environ["DBUS_SESSION_BUS_ADDRESS"] = open(addr_file).read().strip()
    bus = dbus.SessionBus()
    dbus.service.BusName("org.freedesktop.impl.portal.Camera", bus)
    CameraPortalBackend(bus)
    GLib.MainLoop().run()
CAMPY

# Fix ownership so the container's abc user (1000) can write
chown -R 1000:1000 "$BROWSER_PROFILE"

if ! docker ps -q -f name=bender-browser | grep -q .; then
    echo "Starting persistent browser sidecar..."
    docker rm -f bender-browser 2>/dev/null || true
    # Build device flags for webcam (V4L2) passthrough
    DEVICE_FLAGS=""
    [ -n "$V4L2_DEV" ] && [ -e "$V4L2_DEV" ] && DEVICE_FLAGS="$DEVICE_FLAGS --device $V4L2_DEV:$V4L2_DEV"

    docker run -d \
        --name bender-browser \
        --network bender_default \
        --shm-size 1gb \
        $DEVICE_FLAGS \
        -v "$BROWSER_PROFILE":/config \
        -v "$BROWSER_PROFILE/custom-cont-init.d":/custom-cont-init.d:ro \
        -e PUID=1000 \
        -e PGID=1000 \
        -e CUSTOM_PORT=3000 \
        -e CHROME_CLI="https://mail.google.com https://calendar.google.com https://app.slack.com/client --no-first-run --start-maximized --disable-infobars --force-dark-mode --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --remote-allow-origins=* --autoplay-policy=no-user-gesture-required" \
        --restart unless-stopped \
        lscr.io/linuxserver/chromium:latest
    echo "Persistent browser started"
else
    echo "Persistent browser already running, syncing extensions..."
    docker exec bender-browser chown -R 1000:1000 /config/policies 2>/dev/null || true
fi

# Expose CDP port for API notification monitor (Chromium binds 9222 to localhost only)
if ! docker exec bender-browser ss -tln | grep -q ':9223 '; then
    docker exec bender-browser bash -c "apt-get update -qq && apt-get install -y -qq socat >/dev/null 2>&1" || true
    docker exec -d bender-browser socat TCP-LISTEN:9223,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9222
    echo "CDP proxy started on port 9223"
fi

# Android emulator (redroid) + web display (ws-scrcpy)
if ! docker ps -q -f name=bender-android | grep -q .; then
    echo "Starting Android emulator (redroid)..."
    docker rm -f bender-android 2>/dev/null || true
    docker run -d \
        --name bender-android \
        --privileged \
        --network bender_default \
        -v /dev/binderfs:/dev/binderfs \
        redroid/redroid:14.0.0-latest \
        androidboot.redroid_width=1080 \
        androidboot.redroid_height=1920 \
        androidboot.redroid_dpi=420 \
        androidboot.redroid_fps=30 \
        ro.setupwizard.mode=DISABLED
    echo "Android emulator started"
else
    echo "Android emulator already running"
fi

if ! docker ps -q -f name=bender-ws-scrcpy | grep -q .; then
    echo "Starting ws-scrcpy (Android web display)..."
    docker rm -f bender-ws-scrcpy 2>/dev/null || true
    docker run -d \
        --name bender-ws-scrcpy \
        --network bender_default \
        scavin/ws-scrcpy
    echo "ws-scrcpy started, connecting to Android..."
    # Wait for ADB to be available then connect (background, non-blocking)
    (for i in $(seq 1 30); do
        docker exec bender-ws-scrcpy adb connect bender-android:5555 2>/dev/null && break
        sleep 2
    done) &
else
    echo "ws-scrcpy already running"
fi

# Sync templates to persistent volume (always, to pick up updates)
echo "Syncing templates to /data/templates..."
mkdir -p /data/templates
cp -r "$API_SRC/templates/." /data/templates/
# Fix ownership so host user can edit template files (volume-mounted from host)
chown -R 1000:1000 /data/templates/

# Always rebuild API image to pick up code changes
echo "Building API image from $API_SRC..."
docker stop bender-api 2>/dev/null || true
docker rm bender-api 2>/dev/null || true
docker rmi bender-api 2>/dev/null || true
if ! DOCKER_BUILDKIT=0 docker build --no-cache -t bender-api "$API_SRC"; then
    echo "ERROR: API image build failed"
    exit 1
fi
echo "API image built"

# Determine template source
TEMPLATE_SRC="$API_SRC/templates"
[ -d /data/templates ] || mkdir -p /data/templates

# Start API container on the network
echo "Starting API container..."
API_DEVICE_FLAGS=""
[ -n "$V4L2_DEV" ] && [ -e "$V4L2_DEV" ] && API_DEVICE_FLAGS="--device $V4L2_DEV:$V4L2_DEV"
docker run -d \
    --name bender-api \
    --network bender_default \
    --network-alias api \
    $API_DEVICE_FLAGS \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /data:/data \
    -v /data/templates:/app/templates \
    -e DOCKER_HOST=unix:///var/run/docker.sock \
    -e V4L2_DEVICE="${V4L2_DEV}" \
    -e GIT_USER_NAME="${GIT_USER_NAME}" \
    -e GIT_USER_EMAIL="${GIT_USER_EMAIL}" \
    -e GITHUB_TOKEN="${GITHUB_TOKEN}" \
    -e AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
    -e AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
    -e AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION}" \
    -e DIGITALOCEAN_ACCESS_TOKEN="${DIGITALOCEAN_ACCESS_TOKEN}" \
    bender-api
echo "API started"

echo "Setup complete"
