# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0.401-noble@sha256:e70cdb7f80b0348f5cb85f19a8f670fca061f033d57eed12fa003d58b0e06317 AS build
WORKDIR /src
COPY backend/ ./
RUN --mount=type=cache,target=/root/.nuget/packages dotnet restore src/Shop.Api/Shop.Api.csproj --locked-mode
RUN --mount=type=cache,target=/root/.nuget/packages dotnet publish src/Shop.Api/Shop.Api.csproj --no-restore -c Release -o /output -p:UseAppHost=false -m:1

FROM mcr.microsoft.com/dotnet/aspnet:10.0.13-noble@sha256:8af87eba5e7cdafb1514d7388be287365da97c132509e84dfe252ffd552398ca AS runtime
WORKDIR /app
ENV ASPNETCORE_ENVIRONMENT=Production ASPNETCORE_HTTP_PORTS=8080 DataProtection__KeyDirectory=/var/lib/sayman/keys
RUN mkdir -p /var/lib/sayman/keys && chown -R app:app /var/lib/sayman
COPY --from=build --chown=app:app /output/ ./
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["dotnet", "Shop.Api.dll", "--health-probe"]
ENTRYPOINT ["dotnet", "Shop.Api.dll"]
