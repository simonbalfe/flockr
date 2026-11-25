FROM oven/bun:1.3.5 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1.3.5
WORKDIR /app
COPY --from=build /app /app
ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "bun run db:migrate && bun run start"]
