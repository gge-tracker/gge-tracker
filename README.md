<p align="center">
    <img src="https://github.com/user-attachments/assets/be49c503-78da-4ee1-9e14-b6cc80366be5" alt="GGE Tracker Logo" width="200"/>
</p>

<p align="center">
    <img alt="Version" src="https://img.shields.io/github/v/tag/gge-tracker/gge-tracker?label=version"/>
    <img alt="License" src="https://img.shields.io/github/license/gge-tracker/gge-tracker"/>
    <img alt="GitHub contributors" src="https://img.shields.io/github/contributors-anon/gge-tracker/gge-tracker"/>
    <img alt="GitHub forks" src="https://img.shields.io/github/forks/gge-tracker/gge-tracker?style=flat"/>
    <img alt="GitHub top language" src="https://img.shields.io/github/languages/top/gge-tracker/gge-tracker"/>
    <a href="https://discord.gg/eb6WSHQqYh" target="_blank">
        <img src="https://img.shields.io/badge/Discord-GGE%20Tracker-5865f2?logo=discord&style=flat-square" alt="Discord: GGE Tracker"/>
    </a>
    <br>
    <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/gge-tracker/gge-tracker/gge-tracker-projects.yml?branch=main"/>
    <a href="https://sonarcloud.io/summary/new_code?id=gge-tracker_gge-tracker"><img alt="Quality Gate Status" src="https://sonarcloud.io/api/project_badges/measure?project=gge-tracker_gge-tracker&metric=alert_status"/></a>
    <a href="https://sonarcloud.io/summary/new_code?id=gge-tracker_gge-tracker"><img alt="Reliability Rating" src="https://sonarcloud.io/api/project_badges/measure?project=gge-tracker_gge-tracker&metric=reliability_rating"/></a>
</p>

<p align="center">
A comprehensive tracking tool for the game "<a href="https://empire.goodgamestudios.com/">Goodgame Empire</a>" (GGE), designed to help players monitor server activities, player or alliances statistics, and other game-related data.
</p>

## Main components

- **Backend API**: Node.js + Express, provides RESTful endpoints
- **Frontend Application**: Angular web app, interactive interface
- **Scraping Tool**: Node.js service for automatic data collection and updating

## Installation

```bash
# Clone the repository
git clone https://github.com/gge-tracker/gge-tracker.git && cd gge-tracker
# Create a .env file in the root directory with necessary environment variables (see .env.example for reference)
cp .env.example .env && nano .env
# Start the application using Docker Compose (Install Docker and Docker Compose if not already installed)
docker network create backend
docker-compose up --build
```

## Usage

- Web Interface: Access the frontend at `http://localhost:4200`
- API Endpoints: Available at `http://localhost:3000/api/v1`
- Grafana Dashboard: Access at `http://localhost:3001`

## Contributing

Contributions are welcome!

1. Fork the repository
2. Create a new branch (`git checkout -b feature-branch`)
3. Commit your changes (`git commit -m 'Add new feature'`)
4. Push to the branch (`git push origin feature-branch`)
5. Submit a Pull Request

## Project structure

```Shell
├── database # Database configuration and initialization scripts
│   ├── conf # SQL configuration files
│   └── db_migrate.sh # Database migration script
├── docker
│   ├── docker-compose.common.yml # Common Docker Compose configuration
│   └── docker-compose.dev.yml # Development-specific Docker Compose configuration
├── empire-api # Empire API integration module (Custom fork of danadum/empire-api)
├── gge-tracker-backend-api # Backend Express API project
│   ├── src # Project source code
│   ├── Dockerfile.dev # Dockerfile for backend API in development (hot-reload enabled)
│   └── Dockerfile.prod # Dockerfile for backend API in production (static build optimized)
├── gge-tracker-fetcher # Worker service for proxying and fetching data from Goodgame Empire
├── gge-tracker-frontend # Angular frontend application
│   ├── Dockerfile # Optimized Dockerfile for building and serving the Angular app, with nginx as the web server
│   ├── Dockerfile.serve # Development Dockerfile for serving the Angular app (hot-reload enabled)
│   ├── nginx # Nginx configuration for serving the Angular app
│   └── src # Angular project source code
├── gge-tracker-internal-scraping
│   ├── config # Server configuration files
│   ├── scripts # Bash scripts for managing the scraping service (build image, basic fetch, dungeon fetch, etc.)
│   └── src # Scraping service source code
├── gge-tracker-tools # Various utility scripts and tools
├── monitoring # Monitoring stack configuration (Prometheus, Grafana, Loki)
├── sitemap-generator # Sitemap project for SEO optimization and better indexing by search engines
├── .env.example # Example environment variables file
├── .env # Environment variables file (should be created by the user based on .env.example)
└── docker-compose.yaml # Symbolic link to the development Docker Compose file (docker-compose.dev.yml)
```

## System Architecture Diagram
```mermaid
graph TD
    %% ==== EXTERNAL SOURCES ====
    ext_ws[🌐 Goodgame Empire<br>_WebSocket Servers_]
    ext_http[🌐 Goodgame Empire<br>_HTTP Servers_]
    ext_github[🌐 GitHub Pages<br>_i18n repo_]

    %% ==== DATA STORAGE ====
    subgraph datastack[Data Storage Stack]
        mariadb[(MariaDB)]
        postgres[(PostgreSQL)]
        clickhouse[(ClickHouse)]
        redis[(Redis Cache)]
        style datastack fill:#e2affa
        style ext_ws fill:#d4fafc,stroke:#9ed8db
        style ext_ws fill:#d4fafc,stroke:#9ed8db
        style ext_http fill:#d4fafc,stroke:#9ed8db
        style ext_github fill:#d4fafc,stroke:#9ed8db
    end

    %% ==== INTERNAL SERVICES ====
    empireapi[EmpireAPI<br>_REST ⇄ WebSocket bridge_]
    scraping[Internal Scraping<br>_hourly data collection_]
    backend[Backend API<br>_Express / Swagger public API_]
    fetcher[Fetcher<br>_Cloudflare Worker Proxy_]
    sitemap[Sitemap Generator<br>_SEO builder_]
    frontend[Frontend<br>_Angular App_]
    nginx[Nginx<br>_Web Server / Reverse Proxy_]
    i18n[i18n Service<br>_JSON push to GitHub_]

    %% ==== MONITORING ====
    subgraph monitoring[Monitoring Stack]
        promtail[Promtail]
        cadvisor[cAdvisor]
        prometheus[Prometheus]
        grafana[Grafana]
        style monitoring fill:#ffe9c9
        style promtail fill:#fff4e3,stroke:#d1b994
        style cadvisor fill:#fff4e3,stroke:#d1b994
        style prometheus fill:#fff4e3,stroke:#d1b994
        style grafana fill:#fff4e3,stroke:#d1b994
    end

    %% ==== EXTERNAL LINKS ====
    ext_ws -. WebSocket .-> empireapi
    ext_http -. HTTP .-> fetcher
    ext_github -.-> frontend

    %% ==== CORE FLOWS ====
    scraping -->|HTTP requests| empireapi
    scraping -->|Writes data| mariadb
    scraping -->|Writes data| postgres
    scraping -->|Writes data| clickhouse

    empireapi --> backend
    backend -.->|Realtime fetch| empireapi

    backend -->|Reads| mariadb
    backend -->|Reads| postgres
    backend -->|Reads| clickhouse
    backend --> redis

    backend --> fetcher
    fetcher -->|Proxy HTTP| ext_http

    sitemap -->|Reads| postgres
    sitemap -->|Reads| clickhouse
    sitemap -->|Updates build| frontend

    i18n -->|Push YAML| ext_github

    frontend -->|HTTP| backend
    nginx --> frontend

    %% ==== MONITORING CONNECTIONS ====
    promtail --> prometheus
    cadvisor --> prometheus
    backend -.-> prometheus
    scraping -.-> prometheus
    prometheus --> grafana

    %% ==== PUBLIC ENTRYPOINT ====
    user[Users]
    user -->|Browser HTTP| nginx
```
