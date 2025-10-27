# AWS Video Processing Setup Notes

## S3 Bucket Setup for Temporary Video Storage
- **Bucket Name**: `temp.sayedulabrar14045.video`
- **Purpose**: Temporary storage for raw video files
- **Server-side Encryption**: Disabled
- **Other Settings**: Default

## SQS Queue Setup
- **Queue Name**: `TempRawVideoS3Queue`
- **Visibility Timeout**: 1 minute
  - **Description**: Once a Node.js consumer retrieves a message, it becomes invisible to other consumers for 1 minute. This is the processing time for picking the request message, validating it, and starting the Docker process to download the video specified in the message.
- **Server-side Encryption**: Disabled
- **Other Settings**: Default
- **Post-Creation**: Save the queue URL for later use.

### SQS Access Policy Configuration
1. Navigate to **SQS** -> **Access Policy** -> **Edit**.
2. Add the following statement to the policy's statement array to allow the S3 bucket to send messages to the SQS queue:
```json
{
  "Sid": "allowS3BucketToSendMessage",
  "Effect": "Allow",
  "Principal": {
    "Service": "s3.amazon.com"
  },
  "Action": "SQS:SendMessage",
  "Resource": "<SQS Queue ARN from existing statement>",
  "Condition": {
    "ArnLike": {
      "aws:SourceArn": "<S3 Bucket ARN from bucket properties>"
    }
  }
}
```

## S3 Event Notification Setup
1. Go to **S3** -> `temp.sayedulabrar14045.video` -> **Properties** -> **Event Notifications**.
2. Create a new event notification:
   - **Name**: `S3CreateEventToSQS`
   - **Event Types**: Select **ObjectCreate -> All object create events** (to trigger when videos are stored in the bucket).
   - **Destination**: Select **SQS Queue** and choose `TempRawVideoS3Queue` from the search box.
3. Save the configuration.
4. Verify the event notification appears under **Event Notifications**.

### Filtering for Specific File Types
- To limit notifications to `.mp4` files:
  1. Go to **S3** -> **Properties** -> **S3CreateEventToSQS** -> Edit.
  2. Add `.mp4` in the **Suffix** input field.
  3. Save changes. This ensures notifications are only sent for `.mp4` file uploads, ignoring folder creations.

## Testing the Setup
1. In **S3** -> `temp.sayedulabrar14045.video`, create a folder named `videos/`.
2. Upload a video file to the `videos/` folder (manually or via the upload server below).
3. Go to **SQS** -> `TempRawVideoS3Queue` -> **Send and Receive Messages** -> **Poll for Messages**.
   - Without suffix filtering, you will see two messages: one for folder creation and one for video upload.
   - With `.mp4` suffix filtering, only the video upload message will appear.

## Node.js Upload Server Setup
1. Initialize a new Node.js project:
   ```bash
   mkdir video-upload-server
   cd video-upload-server
   npm init -y
   tsc --init
   ```
2. Modify `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "target": "es2016",
       "module": "commonjs",
       "rootDir": "./src",
       "outDir": "./dist",
       "esModuleInterop": true,
       "forceConsistentCasingInFileNames": true,
       "strict": true,
       "skipLibCheck": true
     }
   }
   ```
3. Install dependencies:
   ```bash
   npm install express @aws-sdk/client-s3 multer
   npm install @types/express @types/multer -D
   ```
4. Create the upload server code:

   - **File**: `dummy-get-presignedURL-code.ts`
  
```typescript
import { S3Client, GetObjectCommand ,PutObjectCommand, ListObjectSV2Command} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";


//we have to give s3 full access to the iam user that we will use here.
const s3Client = new S3Client({
  region: "<region, e.g., us-east-1>",
  credentials: {
    accessKeyId: "<your-access-key-id>",
    secretAccessKey: "<your-secret-access-key>",
  },
});


async function getObjectUrl(key){
  const command = new GetObjectCommand({
      Bucket: "temp.sayedulabrar14045.video",
      Key: key,
    });
  const url=getSignedUrl(s3Client,command);
  
  return url;
}


async function putObjectUrl(filename,content_type){
    const command = new PutObjectCommand({
      Bucket: "temp.sayedulabrar14045.video",
      Key: `uploads/user-uploads/${filename}`,
      ContentType: content_type,
    });
    
    const url=getSignedUrl(s3Client,command,{expiresIn:600});
    return url;
}


async function listObjects(){
  const command= new ListObjectSV2Command({
      Bucket: "temp.sayedulabrar14045.video",
      Key: `/`,
  });
  
  const result=await s3Client.send(command);
  console.log(result);
}


async function deleteObjectUrl(key){
  const command = new DeleteObjectCommand({
      Bucket: "temp.sayedulabrar14045.video",
      Key: key,
    });
  await s3Client.send(command);
  
  return url;
}

async function init(){
console.log("URL for uploading ", await putObjectUrl(`image-${Date.now()}.jpeg`, "image/jpeg") );
//Now this will be the url for uploading. It will be used as put request where we will add the file.
//After that we will get the key and pass it to get the public accessible url below. 

}


// async function init(){
// console.log("URL for image-168425674.jpeg ",getObjectUrl("uploads/user-uploads/image-168425674.jpeg") );
// }

init();
```

**Upload securely in Private S3**
<img src="./s3put.png" alt="My drawing" style="width: auto; height: auto;">

   - **File**: `video-upload-server/src/index.ts`
```typescript
import express from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import multer from "multer";
import path from "path";

const app = express();
const port = 3000;

const s3Client = new S3Client({
  region: "<region, e.g., us-east-1>",
  credentials: {
    accessKeyId: "<your-access-key-id>",
    secretAccessKey: "<your-secret-access-key>",
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "video/mp4") {
      cb(null, true);
    } else {
      cb(new Error("Only .mp4 files are allowed"));
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 },
});

app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file provided" });
    }

    const file = req.file;
    const key = `videos/${Date.now()}-${file.originalname}`;

    const command = new PutObjectCommand({
      Bucket: "temp.sayedulabrar14045.video",
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await s3Client.send(command);
    res.status(200).json({ message: "Video uploaded successfully", key });
  } catch (err) {
    console.error(`Upload failed: ${err}`);
    res.status(500).json({ error: "Failed to upload video" });
  }
});

app.listen(port, () => {
  console.log(`Upload server running on port ${port}`);
});
```
5. Update `package.json`:
   ```json
   "scripts": {
     "dev": "tsc-watch --onSuccess \"node dist/index.js\""
   }
   ```
6. Start the server:
   ```bash
   npm run dev
   ```

### Front-End Integration
- Example HTML form:
```html
<!DOCTYPE html>
<html>
<head>
  <title>Video Upload</title>
</head>
<body>
  <form id="uploadForm" enctype="multipart/form-data">
    <input type="file" id="videoInput" name="video" accept="video/mp4" />
    <button type="submit">Upload Video</button>
  </form>
  <script>
    const form = document.getElementById("uploadForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const videoInput = document.getElementById("videoInput");
      const formData = new FormData();
      formData.append("video", videoInput.files[0]);

      try {
        const response = await fetch("http://localhost:3000/upload", {
          method: "POST",
          body: formData,
        });
        const result = await response.json();
        if (response.ok) {
          alert(`Upload successful: ${result.message}`);
        } else {
          alert(`Upload failed: ${result.error}`);
        }
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    });
  </script>
</body>
</html>
```

### IAM Permissions for Upload Server
- Ensure the IAM user/role has:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "s3:PutObject",
        "Resource": "arn:aws:s3:::temp.sayedulabrar14045.video/*"
      }
    ]
  }
  ```

## Node.js Consumer Setup
1. Initialize the Node.js project:
   ```bash
   npm init
   tsc --init
   ```
2. Modify `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "rootDir": "./src",
       "outDir": "./dist"
     }
   }
   ```
3. Install dependencies:
   ```bash
   npm install @aws-sdk/client-sqs
   npm add aws-lambda
   npm i @types/aws-lambda -D
   npm add @aws-sdk/client-ecs
   ```
4. Update `package.json`:
   ```json
   "scripts": {
     "dev": "tsc-watch --onSuccess \"node dist/index\""
   }
   ```

### Node.js Consumer Code
- **File**: `src/index.ts`
```typescript
import { ReceiveMessageCommand, SQSClient, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import type { S3Event } from "aws-lambda";
import { ECSClient, RunTaskCommand } from "@aws-sdk/client-ecs";

const client = new SQSClient({
  region: "<region, e.g., us-east-1>",
  credentials: {
    accessKeyId: "<your-access-key-id>",
    secretAccessKey: "<your-secret-access-key>",
  },
});

const ecsClient = new ECSClient({
  region: "<region, e.g., us-east-1>",
  credentials: {
    accessKeyId: "<your-access-key-id>",
    secretAccessKey: "<your-secret-access-key>",
  },
});

async function init() {
  const command = new ReceiveMessageCommand({
    QueueUrl: "<SQS Queue URL>",
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 20,
  });

  while (true) {
    const { Messages } = await client.send(command);
    if (!Messages?.length) {
      console.log("No Message in Queue");
      continue;
    }

    try {
      for (const message of Messages) {
        if (!message.Body) {
          console.log(`Message ${message.MessageId} missing Body`);
          continue;
        }

        const event = JSON.parse(message.Body) as S3Event;
        if ("Service" in event && "Event" in event) {
          if (event.Event === "s3:TestEvent") {
            await client.send(
              new DeleteMessageCommand({
                QueueUrl: "<SQS Queue URL>",
                ReceiptHandle: message.ReceiptHandle,
              })
            );
            continue;
          }
        }

        for (const record of event.Records) {
          const { s3 } = record;
          const { bucket, object: { key } } = s3;

          const taskCommand = new RunTaskCommand({
            taskDefinition: "<Task Definition ARN>",
            cluster: "<Cluster ARN>",
            launchType: "FARGATE",
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: ["<subnet-1>", "<subnet-2>"],
                securityGroups: ["<security-group>"],
                assignPublicIp: "ENABLED",
              },
            },
            overrides: {
              containerOverrides: [
                {
                  name: "video-transcoder",
                  environment: [
                    { name: "BUCKET_NAME", value: bucket.name },
                    { name: "KEY", value: key },
                  ],
                },
              ],
            },
          });
          await ecsClient.send(taskCommand);

          await client.send(
            new DeleteMessageCommand({
              QueueUrl: "<SQS Queue URL>",
              ReceiptHandle: message.ReceiptHandle,
            })
          );
        }
      }
    } catch (err) {
      console.log(`Message Failed ${err}`);
    }
  }
}

init();
```

## Amazon ECR Setup
- **Repository Name**: `video-transcoder`
- **Settings**: Default
- **Action**: Create the repository and copy the URI for use in ECS.

## Amazon ECS Setup
1. Create a cluster:
   - **Name**: `dev`
   - **Settings**: Default
2. Create a task definition:
   - **Name**: `video-transcoder`
   - **Operating System**: Match the OS where the Docker image was built
   - **CPU**: 2
   - **Memory**: 4 GB
   - **Role**: `ecsTaskExecutionRole`
   - **Container**:
     - **Name**: `video-transcoder`
     - **Image URI**: Paste the URI from ECR
     - **Port Mapping**: None
     - **Storage**: 21 GB
     - **Other Settings**: Default
3. After creation, note the **Task Definition ARN** and **Cluster ARN** for use in the Node.js consumer code.

## Docker Setup
1. Create a second S3 bucket for storing processed video chunks (e.g., `processed.sayedulabrar14045.video`).
2. Configure AWS credentials in the terminal:
   ```bash
   cd container
   export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
   export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
   export AWS_REGION=us-west-2
   ```
3. Start the Docker engine.
4. Go to **ECR** -> **Private Registry** -> **Repositories** -> `video-transcoder` -> **View Push Commands**.
5. Copy and execute the push commands in the `container` directory to push the Docker image.

### Docker Container Code
- **File**: `container/index.js`
```javascript
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("node:fs/promises");
const path = require("node:path");
const fsOld = require("node:fs");
const ffmpeg = require("fluent-ffmpeg");

const Resolutions = [
  { name: "360p", width: 480, height: 360 },
  { name: "480p", width: 858, height: 480 },
  { name: "720p", width: 1280, height: 720 },
];

const client = new S3Client({
  region: "<region, e.g., us-east-1>",
  credentials: {
    accessKeyId: "<your-access-key-id>",
    secretAccessKey: "<your-secret-access-key>",
  },
});

const INPUT_BUCKET_NAME = process.env.BUCKET_NAME;
const INPUT_KEY = process.env.KEY;
const OUTPUT_BUCKET_NAME = "<processed-videos-bucket>";

async function init() {
  const getCommand = new GetObjectCommand({
    Bucket: INPUT_BUCKET_NAME,
    Key: INPUT_KEY,
  });

  const result = await client.send(getCommand);
  const originalFilePath = `original-video.mp4`;
  await fs.writeFile(originalFilePath, result.Body);

  const originalVideoPath = path.resolve(originalFilePath);
  const videoKeyBase = INPUT_KEY.replace(/\.[^/.]+$/, "");

  const promises = Resolutions.map((resolution) => {
    const outputKey = `${videoKeyBase}-${resolution.name}.mp4`;
    const outputFilePath = `video-${resolution.name}.mp4`;
    return new Promise((resolve, reject) => {
      ffmpeg(originalVideoPath)
        .output(outputFilePath)
        .withVideoCodec("libx264")
        .withAudioCodec("aac")
        .withSize(`${resolution.width}x${resolution.height}`)
        .on("end", async () => {
          try {
            const putCommand = new PutObjectCommand({
              Bucket: OUTPUT_BUCKET_NAME,
              Key: outputKey,
              Body: fsOld.createReadStream(path.resolve(outputFilePath)),
            });
            await client.send(putCommand);
            console.log(`Uploaded ${outputKey}`);
            resolve();
          } catch (err) {
            console.error(`Failed to upload ${outputKey}: ${err}`);
            reject(err);
          }
        })
        .on("error", (err) => {
          console.error(`FFmpeg error for ${outputKey}: ${err}`);
          reject(err);
        })
        .format("mp4")
        .run();
    });
  });

  await Promise.all(promises);

  try {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: INPUT_BUCKET_NAME,
      Key: INPUT_KEY,
    });
    await client.send(deleteCommand);
    console.log(`Deleted original video ${INPUT_KEY} from ${INPUT_BUCKET_NAME}`);
  } catch (err) {
    console.error(`Failed to delete original video ${INPUT_KEY}: ${err}`);
  }
}

init().catch((err) => console.error(`Initialization failed: ${err}`));
```

### Dockerfile
- **File**: `container/Dockerfile`
```dockerfile
FROM node:20-alpine AS base

RUN apk update && \
    apk upgrade && \
    apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json .
COPY package-lock.json .

RUN npm install

COPY index.js .

CMD ["npm", "start"]
```

## Notes
- **Upload Server**: The new Node.js server (`video-upload-server`) handles video uploads from the front end, validates files (only `.mp4`, max 100MB), and uploads them to the `temp.sayedulabrar14045.video` bucket with a unique key (e.g., `videos/<timestamp>-<filename>`).
- **Integration**: The upload triggers the existing S3 event notification, which sends a message to `TempRawVideoS3Queue`, processed by the consumer and ECS task as before.
- **Security**: Add authentication to the upload endpoint and ensure IAM permissions are correctly configured. Use HTTPS in production.
- **Alternative**: For direct S3 uploads, use presigned URLs generated by the server, but this requires CORS configuration on the S3 bucket.
- Replace placeholders (`<region>`, `<your-access-key-id>`, `<your-secret-access-key>`, `<SQS Queue URL>`, `<Task Definition ARN>`, `<Cluster ARN>`, `<subnet-1>`, `<subnet-2>`, `<security-group>`, `<processed-videos-bucket>`) with actual values from your AWS console.
- Ensure the Docker image is built and pushed to ECR correctly.
- The Node.js consumer continuously polls the SQS queue, processes messages, and triggers ECS tasks to transcode videos, which upload results to the output bucket and delete the original video from the input bucket.
