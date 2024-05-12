
# Robotics Club Website & Server

A backup and clone of the Robotics Club of Central Florida (RCCF) club website. You can go to our website [here](https://rccf.club/). As this git repo is serving as a backup and commit site more documentation and samples can be found [here](https://secretlibrary.rccf.club/shelves/rccf-website). For more general information or how to join the RCCF web team DM the web team lead on the RCCF [discord](https://discord.gg/Dpe7gjESmy).


## Requirements
- Nodejs >=19
Nodejs install can be found [here](https://nodejs.org/en/download/).
- Docker
On Windows use docker desktop found [here](https://www.docker.com/products/docker-desktop/).

On Linux lazy docker is recommended and could be found [here](https://github.com/jesseduffield/lazydocker).
## Installation

Most of the project is installed using npm, this should be installed alongside Nodejs. Before following the commands below make sure your within the installed dicrectory. In all you should have a docker container running postgres running, and another terminal running the svelte server + client, everything will update as you develop, or evaluate it


To install Nodejs packages and dependencies from a package.json file use:

```bash
npm i
```
Starts the docker based postgres database.
```bash
docker compose up -d
```
Improve RUN performance by pre-loading jigs (may fail on windows but not a requirement).
```bash
npm run db
```
Generrates a prisma client for testing.
```bash
npx prisma generate
```
Creates a draft migration that can be edited live before being applied to the database. 
```bash
npx prisma migrate dev --name RCCF
```
Starts a dev enviornment for you to see changes being made by you live.
```bash
npm run dev
```
## To-Do
- [ ] News Letter/Blog Page
- [ ] About Us Page
- [ ] Constitution (Within About Us)
- [ ] Public Tax Info (Within About Us)
- [ ] Description of Officers (Within About Us)
- [ ] Sponsors page (Within About Us)
- [ ] Contact Us Page
- [x] Summer Term Button (free trial)
- [ ] Gallery Page 
- [ ] Member’s Page
- [ ] QR Code Tracker System
- [ ] Fading Projects Blocks
- [ ] Github Link/Icon
- [ ] Member's Survey




## License
[MIT](https://choosealicense.com/licenses/mit/)
