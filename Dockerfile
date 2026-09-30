FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY tsconfig.json ./
COPY app ./app
COPY pitch ./pitch
COPY anchor/target/idl/stillpaid.json ./anchor/target/idl/stillpaid.json
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=4050 DATA_DIR=/data
EXPOSE 4050
CMD ["node", "--import", "tsx", "app/server.ts"]
