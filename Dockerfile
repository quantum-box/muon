FROM rust:1.83-slim AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY Cargo.lock* ./
RUN if [ ! -f Cargo.lock ]; then cargo generate-lockfile; fi
COPY src/ src/
COPY ui/dist/ ui/dist/
COPY migrations/ migrations/
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/muon /usr/local/bin/
ENV PORT=8080
EXPOSE 8080
CMD ["muon", "serve", "--port", "8080"]
