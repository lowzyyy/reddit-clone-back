FROM node:18-alpine3.18

COPY src /app/src
COPY package.json /app/
COPY package-lock.json /app/
COPY tsconfig.json /app/

# COPY .env /app/

WORKDIR /app

RUN npm i
RUN npm run build


CMD [ "npm","start" ]