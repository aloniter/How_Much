FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
ENV PORT=3000 DATA_DIR=/data
# Family history lives here — mount a volume so it survives redeploys:  docker run -v checkmate-data:/data ...
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
