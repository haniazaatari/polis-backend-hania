FROM docker.io/clojure:temurin-17-bullseye-slim

WORKDIR /app
# Set JVM options
ENV JAVA_OPTS="-Xms4g -Xmx8g -XX:+UseG1GC"
COPY . .

# Install clojure and fetch dependencies
RUN clojure -A:dev -P
ENV JAVA_OPTS="-Xms4g -Xmx8g -XX:+UseG1GC"

CMD ["./bin/run"]