const generatedId = /^environment-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export const generatedEnvironmentId = jobId => 'environment-' + jobId;
export const isGeneratedEnvironment = asset => asset.kind === 'environment' && generatedId.test(asset.assetId);
