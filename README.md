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

### 5) Configure S3 access for files-service (IRSA recommended)

The files service uploads/downloads objects from S3. On EKS, the recommended approach is IRSA (IAM Roles for Service Accounts) so you do not store AWS keys in environment variables.

1) Create (or choose) an S3 bucket and a prefix, e.g. `gratitude-uploads/`.

2) Ensure the EKS cluster has an IAM OIDC provider:

```bash
eksctl utils associate-iam-oidc-provider --cluster <cluster-name> --region <region> --approve
```

3) Create an IAM policy for S3 access (adjust bucket/prefix as needed):

```bash
cat <<'EOF' > files-service-s3-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "AllowListBucket",
            "Effect": "Allow",
            "Action": "s3:ListBucket",
            "Resource": "arn:aws:s3:::prashant-mckinsey-bucket"
        },
        {
            "Sid": "AllowObjectCRUD",
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject"
            ],
            "Resource": "arn:aws:s3:::prashant-mckinsey-bucket/gratitude-uploads/*"
        }
    ]
}
EOF

aws iam create-policy \
  --policy-name GratitudeAppFilesServiceS3 \
  --policy-document file://files-service-s3-policy.json
```

4) Create a Kubernetes service account mapped to an IAM role with that policy:

```bash
export AWS_ACCOUNT_ID="<account-id>"
export AWS_REGION="<region>"
export CLUSTER_NAME="<cluster-name>"
export POLICY_ARN="arn:aws:iam::$AWS_ACCOUNT_ID:policy/GratitudeAppFilesServiceS3"

eksctl create iamserviceaccount \
  --name files-service-sa \
  --namespace default \
  --cluster "$CLUSTER_NAME" \
  --region "$AWS_REGION" \
  --attach-policy-arn "$POLICY_ARN" \
  --approve
```

5) Update `k8s/files-service-deployment.yml` to use that service account and set bucket env vars:

```yaml
spec:
  template:
    spec:
      serviceAccountName: files-service-sa
      containers:
        - name: files-service
          env:
            - name: AWS_REGION
              value: "<region>"
            - name: S3_BUCKET
              value: "<bucket-name>"
            - name: S3_PREFIX
              value: "<prefix>"
```

If you cannot use IRSA, inject `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optional `AWS_SESSION_TOKEN` via a Kubernetes Secret instead.

### 6) (Optional) Build images and push to ECR

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
aws ecr create-repository --repository-name gratitudeapp-files-service

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
docker build -t "$ECR_BASE/gratitudeapp-files-service:$TAG" services/files-service

docker push "$ECR_BASE/gratitudeapp-client:$TAG"
docker push "$ECR_BASE/gratitudeapp-api-gateway:$TAG"
docker push "$ECR_BASE/gratitudeapp-entries:$TAG"
docker push "$ECR_BASE/gratitudeapp-moods-api:$TAG"
docker push "$ECR_BASE/gratitudeapp-moods-service:$TAG"
docker push "$ECR_BASE/gratitudeapp-server:$TAG"
docker push "$ECR_BASE/gratitudeapp-stats-api:$TAG"
docker push "$ECR_BASE/gratitudeapp-stats-service:$TAG"
docker push "$ECR_BASE/gratitudeapp-files-service:$TAG"
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
- `k8s/files-service-deployment.yml`

### 7) Apply manifests

Apply the storage class, secrets, and application manifests in order:

```bash
kubectl apply -f k8s/storageclass-gp3-default.yml
kubectl apply -f k8s/database-secret.yml
kubectl apply -f k8s/postgres-init-config.yml
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
kubectl apply -f k8s/files-service-deployment.yml
kubectl apply -f k8s/files-service-cluster-ip-service.yml
kubectl apply -f k8s/server-deployment.yml
kubectl apply -f k8s/server-cluster-ip-service.yml
kubectl apply -f k8s/client-deployment.yml
kubectl apply -f k8s/client-cluster-ip-service.yml
kubectl apply -f k8s/client-service.yml
kubectl apply -f k8s/ingress-service.yml
```

### 8) (Optional) Run the one-time DB migration for existing databases

If Postgres is already initialized (existing PVC), init scripts will not re-run. Apply this Job once to ensure the `moods` table exists:

```bash
kubectl apply -f k8s/postgres-migrate-job.yml
```

If you need to rerun it, delete the job and re-apply:

```bash
kubectl delete job postgres-migrate-moods
kubectl apply -f k8s/postgres-migrate-job.yml
```

### 9) Verify and access the app

```bash
kubectl get pods
kubectl get svc -n ingress-nginx
kubectl get ingress
```

Find the external address from the ingress-nginx service or the ingress resource and open it in your browser.
