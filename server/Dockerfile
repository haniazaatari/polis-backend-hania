# To build locally, for example:
# docker build -t polis-server:local .
# To run locally, for example:
# docker run --rm --name polis-server --env-file .env --network polis-dev_polis-net \
#  -p 5000:5000 --target dev polis-server:local
#
# For a dev build, use `--target dev`.
# Should default to prod build, but you can also explicitly use `--target prod`

FROM node:18-bullseye-slim AS base

ARG NODE_ENV

WORKDIR /app

# Install git and libpq-dev using apt-get (Debian's package manager)
RUN apt-get update && \
    apt-get install -y --no-install-recommends git libpq-dev python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./

EXPOSE 5000


# Define the development build

FROM base as dev

# Set default NODE_ENV to development unless overridden at build time with --build-arg NODE_ENV=production
ENV NODE_ENV ${NODE_ENV:-development}

COPY . .

CMD npm run dev



# Define the production build

FROM base as prod

# Set default NODE_ENV to production unless overridden at build time with --build-arg NODE_ENV=development
ENV NODE_ENV ${NODE_ENV:-production}

RUN npm ci --production=false

COPY . .

RUN npm run build

CMD npm run serve