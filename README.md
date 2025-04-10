DoggyHits.com

powers www.doggyhits.com

written with manus ai

a lambda scans youtube for latest 200 funny dog videos.

a cloudwatch schedule triggers this lambda twice an hour. the youtube api key is stored in secrets manager and made available to lambda function.

the lambda fuhction generates the index.html file which is served to user. this contains the css and js 

index.html copied into s3 bucket configured as static website.

https added via cloud front. 

domain doggyhits.com configured in r53



