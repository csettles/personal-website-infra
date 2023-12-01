import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { CfnDistribution, CfnOriginAccessControl, CloudFrontAllowedMethods, CloudFrontWebDistribution, HttpVersion, OriginAccessIdentity, SSLMethod, SecurityPolicyProtocol, ViewerCertificate, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';

const DOMAIN_NAME = "caitlinsettles.com"

export class WebsiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const hz = route53.HostedZone.fromLookup(this, 'Zone', { domainName: DOMAIN_NAME });

    const cert = new Certificate(this, 'Cert', {
      domainName: DOMAIN_NAME,
      validation: CertificateValidation.fromDns(hz),
      subjectAlternativeNames: [`*.${DOMAIN_NAME}`]
    })

    const bucket = new s3.Bucket(this, 'WebsiteContents', {
      bucketName: DOMAIN_NAME,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET],
        allowedOrigins: [`https://${DOMAIN_NAME}`],
      }]
    })

    const viewerCert = ViewerCertificate.fromAcmCertificate(cert, {
      securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2021,
      sslMethod: SSLMethod.SNI,
      aliases: [
        DOMAIN_NAME,
        `*.${DOMAIN_NAME}`
      ]
    })

    const cfLogs = new s3.Bucket(this, 'CFLogging', {
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER
    })
    const cfDist = new CloudFrontWebDistribution(this, 'CFDist', {
      viewerCertificate: viewerCert,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      loggingConfig: {
        bucket: cfLogs
      },
      errorConfigurations: [{
        errorCode: 404,
        responseCode: 404,
        responsePagePath: "/404.html",
      }],
      originConfigs: [{
        behaviors: [{
          isDefaultBehavior: true,
          allowedMethods: CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
          compress: false,
        }],
        s3OriginSource: {
          s3BucketSource: bucket,
          originShieldRegion: this.region,
        },
      }]
    })

    const oac = new CfnOriginAccessControl(this, 'OAC', {
      originAccessControlConfig: {
        name: "OAC",
        originAccessControlOriginType: "s3",
        signingBehavior: "always",
        signingProtocol: "sigv4"
      }
    })

    // hacky way to add OAC (since cdk currently only supports OAI)
    // see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
    // and https://github.com/aws/aws-cdk/issues/21771
    const cfnDistribution = cfDist.node.defaultChild as CfnDistribution
    cfnDistribution.addOverride('Properties.DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', "")
    cfnDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', oac.getAtt('Id'))

    bucket.grantRead(new ServicePrincipal("cloudfront.amazonaws.com", {
      conditions: {
        StringEquals: {
          "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${cfDist.distributionId}`
        }
      }
    }))

    new route53.ARecord(this, 'WebsiteARecord', {
      zone: hz,
      target: route53.RecordTarget.fromAlias(new CloudFrontTarget(cfDist))
    })

    new route53.ARecord(this, 'WebsiteARecord', {
      zone: hz,
      recordName: "*",
      target: route53.RecordTarget.fromAlias(new CloudFrontTarget(cfDist))
    })

    new BucketDeployment(this, 'BucketDeployment', {
      destinationBucket: bucket,
      sources: [Source.asset("./src")]
    })
  }
}
