FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir /data && chown node /data
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
