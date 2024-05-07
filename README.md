# Robotics Club Website & Server

## How to run

    requirements:
        docker & docker compose
        or docker desktop
        nodejs >=19
    npm i
    npm run build # This will take a while
    docker compose up -d
    change env file to push to localhost for the postgres
    npx prisma migrade dev --name RCCF

    profit

    in all you should have a docker container running postgres running, and another terminal running the svelte server + client, everyting will update as you develop, or evaluate it

## migrate db

    this command will migrate all changes automatically
    npx prisma migrate dev --name RCCF

# TODO

add project pages - if teamlead, add ability to make post - if teamlead, add ability to edit project info
add about page
add sponsors page
add members list
add officers list

low key want the website to look like the langing page for github

### NOTES

authentication
<https://joyofcode.xyz/sveltekit-authentication-using-cookies>
