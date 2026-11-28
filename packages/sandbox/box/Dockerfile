FROM debian:trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git ripgrep util-linux procps \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 1000 --user-group --home-dir /workspace --no-create-home box \
  && mkdir /workspace \
  && chown 1000:1000 /workspace
ENV HOME=/workspace
WORKDIR /workspace
CMD ["sleep", "infinity"]
