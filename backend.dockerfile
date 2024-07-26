FROM node:slim

ARG SEARXNG_API_URL
ARG ANTHROPIC_API_KEY

WORKDIR /home/perplexica

COPY src /home/perplexica/src
COPY tsconfig.json /home/perplexica/
COPY config.toml /home/perplexica/
COPY drizzle.config.ts /home/perplexica/
COPY package.json /home/perplexica/
COPY yarn.lock /home/perplexica/

RUN sed -i "s|SEARXNG = \".*\"|SEARXNG = \"${SEARXNG_API_URL}\"|g" /home/perplexica/config.toml
RUN sed -i "s|ANTHROPIC = \".*\"|ANTHROPIC = \"${ANTHROPIC_API_KEY}\"|g" /home/perplexica/config.toml

RUN mkdir /home/perplexica/data

RUN yarn install 
RUN yarn build

CMD ["yarn", "start"]