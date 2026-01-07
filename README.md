# GratitudeApp

## Deploy on Amazon EKS

These steps deploy the Kubernetes manifests in `k8s/` onto an EKS cluster.

### Prerequisites

- AWS account with access to EKS and ECR/ELB.
- `aws`, `kubectl`, and `helm` installed locally.
- An existing EKS cluster (or create one with `eksctl`).

### 1) Configure kubectl for your EKS cluster

Use AWS to generate kubeconfig credentials. Do not apply `k8s/config.yml` to the cluster; it contains a kubeconfig with credentials.

```bash
aws eks update-kubeconfig --region <region> --name <cluster-name>
kubectl config current-context
```

### 2) Install the EBS CSI driver (for gp3 storage)

The repo includes a gp3 StorageClass in `k8s/storageclass-gp3-default.yml`. Ensure the EBS CSI driver is installed:

```bash
eksctl create addon --name aws-ebs-csi-driver --cluster <cluster-name> --region <region>
```

If you already use the EKS add-on via the console, you can skip this step.

### 3) Install the NGINX ingress controller

The ingress manifest uses `ingressClassName: nginx`. Install ingress-nginx:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace
```

### 4) Configure secrets

Update these files before applying:

- `k8s/openai-api-secret.yml`: set `OPENAI_API_KEY`.
- `k8s/database-secret.yml`: change the default `PGPASSWORD` (base64-encoded).

Example to generate a base64-encoded Postgres password:

```bash
echo -n "<new-password>" | base64
```

### 5) (Optional) Build images and push to ECR

If you want to build from scratch, create ECR repos, build Docker images, and push them. After pushing, update the `image:` fields in the Kubernetes manifests to point at your ECR images.

```bash
export AWS_ACCOUNT_ID="<account-id>"
export AWS_REGION="<region>"
export TAG="<tag>"
export ECR_BASE="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

aws ecr create-repository --repository-name gratitudeapp-client
aws ecr create-repository --repository-name gratitudeapp-api-gateway
aws ecr create-repository --repository-name gratitudeapp-entries
aws ecr create-repository --repository-name gratitudeapp-moods-api
aws ecr create-repository --repository-name gratitudeapp-moods-service
aws ecr create-repository --repository-name gratitudeapp-server
aws ecr create-repository --repository-name gratitudeapp-stats-api
aws ecr create-repository --repository-name gratitudeapp-stats-service

aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_BASE"

docker build -t "$ECR_BASE/gratitudeapp-client:$TAG" client
docker build -t "$ECR_BASE/gratitudeapp-api-gateway:$TAG" services/api-gateway
docker build -t "$ECR_BASE/gratitudeapp-entries:$TAG" services/entries-service
docker build -t "$ECR_BASE/gratitudeapp-moods-api:$TAG" services/moods-api
docker build -t "$ECR_BASE/gratitudeapp-moods-service:$TAG" services/moods-service
docker build -t "$ECR_BASE/gratitudeapp-server:$TAG" services/server-main
docker build -t "$ECR_BASE/gratitudeapp-stats-api:$TAG" services/stats-api
docker build -t "$ECR_BASE/gratitudeapp-stats-service:$TAG" services/stats-service

docker push "$ECR_BASE/gratitudeapp-client:$TAG"
docker push "$ECR_BASE/gratitudeapp-api-gateway:$TAG"
docker push "$ECR_BASE/gratitudeapp-entries:$TAG"
docker push "$ECR_BASE/gratitudeapp-moods-api:$TAG"
docker push "$ECR_BASE/gratitudeapp-moods-service:$TAG"
docker push "$ECR_BASE/gratitudeapp-server:$TAG"
docker push "$ECR_BASE/gratitudeapp-stats-api:$TAG"
docker push "$ECR_BASE/gratitudeapp-stats-service:$TAG"
```

Update the image values in these files to match your ECR account/region/tag:

- `k8s/client-deployment.yml`
- `k8s/api-gateway-deployment.yml`
- `k8s/entries-deployment.yml`
- `k8s/moods-api-deployment.yml`
- `k8s/moods-service-deployment.yml`
- `k8s/server-deployment.yml`
- `k8s/stats-api-deployment.yml`
- `k8s/stats-service-deployment.yml`

### 6) Apply manifests

Apply the storage class, secrets, and application manifests in order:

```bash
kubectl apply -f k8s/storageclass-gp3-default.yml
kubectl apply -f k8s/database-secret.yml
kubectl apply -f k8s/openai-api-secret.yml
kubectl apply -f k8s/database-persistent-volume-claim.yml
kubectl apply -f k8s/postgres-deployment.yml
kubectl apply -f k8s/postgres-cluster-ip-service.yml
kubectl apply -f k8s/api-gateway-deployment.yml
kubectl apply -f k8s/api-gateway-cluster-ip-service.yml
kubectl apply -f k8s/entries-deployment.yml
kubectl apply -f k8s/entries-cluster-ip-service.yml
kubectl apply -f k8s/moods-api-deployment.yml
kubectl apply -f k8s/moods-api-cluster-ip-service.yml
kubectl apply -f k8s/moods-service-deployment.yml
kubectl apply -f k8s/moods-service-cluster-ip-service.yml
kubectl apply -f k8s/stats-api-deployment.yml
kubectl apply -f k8s/stats-api-cluster-ip-service.yml
kubectl apply -f k8s/stats-service-deployment.yml
kubectl apply -f k8s/stats-service-cluster-ip-service.yml
kubectl apply -f k8s/server-deployment.yml
kubectl apply -f k8s/server-cluster-ip-service.yml
kubectl apply -f k8s/client-deployment.yml
kubectl apply -f k8s/client-cluster-ip-service.yml
kubectl apply -f k8s/client-service.yml
kubectl apply -f k8s/ingress-service.yml
```

### 7) Verify and access the app

```bash
kubectl get pods
kubectl get svc -n ingress-nginx
kubectl get ingress
```

Find the external address from the ingress-nginx service or the ingress resource and open it in your browser.
