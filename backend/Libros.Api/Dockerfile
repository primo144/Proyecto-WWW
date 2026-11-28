FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/Libros.Api/Libros.Api.csproj ./Libros.Api/
RUN dotnet restore ./Libros.Api/Libros.Api.csproj
COPY backend/Libros.Api/ ./Libros.Api/
WORKDIR /src/Libros.Api
RUN dotnet publish Libros.Api.csproj --configuration Release --output /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_HTTP_PORTS=8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Libros.Api.dll"]
