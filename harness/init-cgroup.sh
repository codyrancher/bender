#!/bin/bash
# Enable cgroup v2 memory+io controller delegation so nested containers (e.g. rancher/k3s) work.
# cgroup v2 "no internal processes" rule: all processes must be in leaf cgroups
# before we can enable controllers on subtree_control.

if [ -f /sys/fs/cgroup/cgroup.subtree_control ] && ! grep -q memory /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null; then
    mkdir -p /sys/fs/cgroup/init.scope
    # Move all processes from root cgroup into init.scope
    for pid in $(cat /sys/fs/cgroup/cgroup.procs 2>/dev/null); do
        echo "$pid" > /sys/fs/cgroup/init.scope/cgroup.procs 2>/dev/null || true
    done
    # Enable controllers on root
    for ctrl in memory io hugetlb; do
        echo "+${ctrl}" > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
    done
    echo "cgroup v2 controllers enabled: $(cat /sys/fs/cgroup/cgroup.subtree_control)"
fi

# Increase inotify limits for nested k3s/rancher containers
echo 1024 > /proc/sys/fs/inotify/max_user_instances 2>/dev/null || true
echo 1048576 > /proc/sys/fs/inotify/max_user_watches 2>/dev/null || true

# Start supervisord (which starts dockerd + setup)
exec supervisord -c /etc/supervisord.conf
