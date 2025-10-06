# GGE Tracker

![Logo](https://github.com/user-attachments/assets/be49c503-78da-4ee1-9e14-b6cc80366be5)

![Version](https://img.shields.io/github/v/tag/gge-tracker/gge-tracker?label=version)
![License](https://img.shields.io/github/license/gge-tracker/gge-tracker)
![GitHub contributors](https://img.shields.io/github/contributors-anon/gge-tracker/gge-tracker)
![GitHub forks](https://img.shields.io/github/forks/gge-tracker/gge-tracker?style=flat)
![GitHub top language](https://img.shields.io/github/languages/top/gge-tracker/gge-tracker)

A comprehensive tracking tool for the game "<a href="https://empire.goodgamestudios.com/">Goodgame Empire</a>" (GGE), designed to help players monitor server activities, player or alliances statistics, and other game-related data.

Website: https://gge-tracker.com

## Components
- **Backend API**: Node.js + Express, provides RESTful endpoints
- **Frontend Application**: Angular web app, interactive interface
- **Scraping Tool**: Node.js service for automatic data collection and updating

## Installation
```bash
git clone https://github.com/gge-tracker/gge-tracker.git
cd gge-tracker
# Create a .env file in the root directory with necessary environment variables (see .env.example for reference)
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


