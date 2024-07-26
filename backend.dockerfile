FROM node:slim

ARG SEARXNG_API_URL
ARG ANTHROPIC_API_KEY
ARG HASURA_ADMIN_SECRET
ARG HASURA_ENDPOINT

WORKDIR /home/perplexica

COPY src /home/perplexica/src
COPY tsconfig.json /home/perplexica/
COPY sample.config.toml /home/perplexica/config.toml
COPY drizzle.config.ts /home/perplexica/
COPY package.json /home/perplexica/

RUN sed -i "s|SEARXNG = \".*\"|SEARXNG = \"${SEARXNG_API_URL}\"|g" /home/perplexica/config.toml
RUN sed -i "s|ANTHROPIC = \".*\"|ANTHROPIC = \"${ANTHROPIC_API_KEY}\"|g" /home/perplexica/config.toml
RUN sed -i "s|HASURA_ADMIN_SECRET = \".*\"|HASURA_ADMIN_SECRET = \"${HASURA_ADMIN_SECRET}\"|g" /home/perplexica/config.toml
RUN sed -i "s|HASURA_ENDPOINT = \".*\"|HASURA = \"${HASURA_ENDPOINT}\"|g" /home/perplexica/config.toml


RUN mkdir /home/perplexica/data

RUN npm install 
RUN npm run build

CMD ["npm", "run", "start"]