FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown node /data
ENV PORT=3000
EXPOSE 3000
# Starts as root only to fix ownership of a mounted volume, then runs the app as "node".
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
