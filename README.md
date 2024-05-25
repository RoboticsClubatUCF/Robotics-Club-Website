
# Robotics Club Website & Server

A backup and clone of the Robotics Club of Central Florida (RCCF) club website. You can go to our website [here](https://rccf.club/). As this git repo is serving as a backup and commit site more documentation and samples can be found [here](https://secretlibrary.rccf.club/shelves/rccf-website). For more general information or how to join the RCCF web team DM the web team lead on the RCCF [discord](https://discord.gg/Dpe7gjESmy).


## Requirements
- Nodejs >=19
Nodejs install can be found [here](https://nodejs.org/en/download/).
- Docker
On Windows use docker desktop found [here](https://www.docker.com/products/docker-desktop/).

On Linux lazy docker is recommended and can be found [here](https://github.com/jesseduffield/lazydocker).
## Installation

Most of the project is installed using npm, this should be installed alongside Nodejs. Before following the commands below make sure your within the installed directory. In all you should have a docker container running postgres running, and another terminal running the svelte server + client, everything will update as you develop, or evaluate it


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
Generates a prisma client for testing.
```bash
npx prisma generate
```
Creates a draft migration that can be edited live before being applied to the database. 
```bash
npx prisma migrate dev --name RCCF
```
Starts a dev environment for you to see changes being made by you live.
```bash
npm run dev
```
To access the Prisma database use
```bash
npm run studio
```
## To-Do
- [ ] Update Home Page
    - [ ] Description of Officers
    - [ ] Update Cards
    - [ ] FRQ section
- [ ] Sponsors page
    - [ ] Tier List
    - [ ] Contact us
- [ ] Contact Us Page
- [ ] Gallery Page 
- [ ] Member’s Page
- [ ] News Letter/Blog Page
- [x] Summer Term Button (free trial)
- [ ] QR Code Tracker System
- [ ] Fading Projects Blocks
- [ ] Github Link/Icon
- [ ] Edit profile as a separate button
- [x] Member's Survey
    - [x] Major "other" dropdown
    - [x] Membership history after selecting yes to "previous member?" (semester, 1 year, 2 years 3 years, etc.)
    - [x] Fix allergies/disabilities options
        - [x] Add "other" dropdown
    - [x] How did you hear about us?
    - [x] Forced renewal of survey (every 4 months)
- [ ] Custom Profile Pictures
- [ ] Actually working Forget Password
- [ ] Custom Profile Pictures
- [ ] Add first and last name to the survey database




## License
[MIT](https://choosealicense.com/licenses/mit/)
