FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY index.html styles.css extra.css data.js app.js server.mjs ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/app/data

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "server.mjs"]
