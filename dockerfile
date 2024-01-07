FROM node:18-alpine3.18
WORKDIR /RCCF-WEB
COPY . .
RUN npm i
RUN npx prisma generate
RUN npm run build
EXPOSE 4173
# This is Temporary as we dont have a proper build system yet
ENTRYPOINT [ "npm","run","preview" ]