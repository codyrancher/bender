# Template: Rancher Dashboard

Rancher dev environment

## How Templates Work

This directory IS the template. When a user creates a new project with this template, every file here (except metadata files) gets copied into the new project's workspace.

### Handlebars (.hbs) files
Files ending in `.hbs` are processed through **Handlebars** during scaffolding. The `.hbs` extension is stripped from the output filename.

For example: `init.sh.hbs` becomes `init.sh` in the project.

### Available template variables
Use `{{variableName}}` in .hbs files. Available variables:

| Variable | Description |
|----------|-------------|
| `{{projectName}}` | The project name chosen by the user |
| `{{adminPassword}}` | Auto-generated secure password |
| `{{userPassword1}}` through `{{userPassword3}}` | Additional auto-generated passwords |
| `{{gitName}}` | User's git name from gitconfig |
| `{{gitEmail}}` | User's git email from gitconfig |
| `{{nodeVersion}}` | Node version (if specified during project creation) |
| `{{rancherTag}}` | Rancher tag (if specified during project creation) |

> **Credentials are NOT template variables.** Secrets (GitHub token,
> AWS/DigitalOcean cloud keys) are injected into the container as
> **environment variables** and must never be written into scaffolded files.
> Reference them in shell at runtime, e.g. `$GITHUB_TOKEN`, `$AWS_ACCESS_KEY_ID`,
> `$DIGITALOCEAN_ACCESS_TOKEN`. They come from the host `.env` (see `.env.example`).

### Metadata files (not copied to projects)
These files configure the template itself and are NOT scaffolded:

- **template.json** — Template metadata (name, description, sidecars). Edit this to change the template's display name, description, or to configure sidecar containers.
- **browser-port.json** — Sets the default browser sidecar port (e.g., `{"port": 3000}`)
- **icon.svg** — Template icon shown in the UI
- **CLAUDE.md** — This file (auto-generated, not scaffolded)

### template.json structure
```json
{
  "name": "Template Display Name",
  "description": "What this template does",
  "sidecars": [
    {
      "suffix": "browser",
      "image": "lscr.io/linuxserver/chromium:latest",
      "shm_size": "1gb",
      "network_container": true,
      "env": {
        "PUID": "1000",
        "PGID": "1000",
        "CUSTOM_PORT": "3000"
      }
    }
  ]
}
```

Sidecars are additional Docker containers started alongside the project. Common sidecars:
- **browser** — Chromium browser accessible via the harness UI
- **rancher** — Rancher server container with network_container pointing to it

### Shell scripts
Files ending in `.sh` automatically get executable permissions (chmod 755).

### Special files
- **init.sh** — If present, runs inside the project container after startup
- **shutdown.sh** — If present, runs before the project is deleted
- **.env** — Environment variables for the project

### Key conventions
- Use Handlebars for anything that needs to be customized per-project (passwords, names, URLs)
- Non-.hbs files are copied verbatim
- Directory structure is preserved exactly
- The project workspace is at `/workspace` in the project container
- Projects run as UID 1000
