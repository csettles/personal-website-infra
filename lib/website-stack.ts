import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Certificate, CertificateValidation, DnsValidatedCertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { CertificateAuthority } from 'aws-cdk-lib/aws-acmpca';
import { CloudFrontAllowedMethods, CloudFrontWebDistribution, HttpVersion, OriginAccessIdentity, ViewerCertificate, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3DeployAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { Artifact, ArtifactPath } from 'aws-cdk-lib/aws-codepipeline';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { RegionInfo } from 'aws-cdk-lib/region-info';
import { CloudFrontTarget, Route53RecordTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';

const DOMAIN_NAME = "caitlinsettl.es"

export class WebsiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'WebsiteQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    

    const hz = new route53.PublicHostedZone(this, 'WebsiteHostedZone', {
      zoneName: DOMAIN_NAME,
      caaAmazon: true
    })

    const cert = new Certificate(this, 'Cert', {
      domainName: DOMAIN_NAME,
      validation: CertificateValidation.fromDns(hz),
    })

    const bucket = new s3.Bucket(this, 'WebsiteContents', {
      bucketName: DOMAIN_NAME,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      encryption: s3.BucketEncryption.S3_MANAGED,
    })

    const cfDist = new CloudFrontWebDistribution(this, 'CFDist', {
      viewerCertificate: ViewerCertificate.fromAcmCertificate(cert),
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      errorConfigurations: [{
        errorCode: 404,
        responseCode: 404,
        responsePagePath: "404.html"
      }],
      originConfigs: [{
        behaviors: [{
          isDefaultBehavior: true,
          allowedMethods: CloudFrontAllowedMethods.GET_HEAD,
          compress: false
        }],
        s3OriginSource: {
          s3BucketSource: bucket,
          originShieldRegion: this.region
        }
      }]
    })

    new route53.ARecord(this, 'WebsiteARecord', {
      zone: hz,
      target: route53.RecordTarget.fromAlias(new CloudFrontTarget(cfDist))
    })

    new BucketDeployment(this, 'BucketDeployment', {
      destinationBucket: bucket,
      sources: [Source.asset("./src")]
    })
  }
}
