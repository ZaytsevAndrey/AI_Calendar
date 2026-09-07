# AI Calendar Assistant

Web app for time planning: **day phases**, **tasks**, **sleep/wake settings**, **Google Calendar** integration, and an automatic schedule from the **Calendar** page (`/calendar`).

## Documentation

All up-to-date docs live under **[documentation/](documentation/README.md)**:

- [Overview and architecture](documentation/overview.md)  
- [Setup and build](documentation/setup-and-build.md)  
- [API reference](documentation/api-reference.md)  
- [Google OAuth / Calendar](documentation/integrations.md)  
- [Deploy (Render + Neon)](documentation/deploy.md)  
- [Roadmap](documentation/roadmap.md)  

After starting the backend, interactive API docs: `http://localhost:3001/api` (Swagger).

## Quick start

```bash
git clone git@github.com:ZaytsevAndrey/AI_Calendar.git
cd AI_Calendar
npm ci
```

Create `backend/.env` and `frontend/.env` from the examples in the repo; see [setup-and-build](documentation/setup-and-build.md).

```bash
npm start
```

Typical URLs: frontend **http://localhost:3000**, API **http://localhost:3001**.

Production (free): [Deploy on Render + Neon](documentation/deploy.md).

## Useful commands (from root)

| Command | Action |
|---------|--------|
| `npm start` | Frontend + backend |
| `npm run build` | Build both packages |
| `npm run build:frontend` | Frontend only |
| `npm run build:backend` | Backend only |
| `npm run test` | Tests in workspaces |
| `npm run clean` | Remove `node_modules`, `dist`, `build` |

## Repository

- **Development branch:** `develop`  
- Issues: [GitHub Issues](https://github.com/ZaytsevAndrey/AI_Calendar/issues)
