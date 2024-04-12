#!/bin/bash

# Read version from package.json
VERSION=$(jq -r '.version' package.json)

if [ -z "$VERSION" ]; then
  echo "Error: Failed to extract version from package.json."
  exit 1
fi

# Define the Docker image name and tag
IMAGE_NAME="openiap/mongo-k8s-sidecar"
IMAGE_TAG="$VERSION"

# Build the Docker image
docker build -t "$IMAGE_NAME:$IMAGE_TAG" .

# Push the Docker image to a container registry
docker push "$IMAGE_NAME:$IMAGE_TAG"

# Check if the push was successful
if [ $? -eq 0 ]; then
  echo "Docker image $IMAGE_NAME:$IMAGE_TAG successfully built and pushed."
else
  echo "Error: Docker image push failed."
  exit 1
fi

exit 0
