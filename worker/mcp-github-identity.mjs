// Server-side GitHub identity gate for Easybook OAuth.
// This module never accepts a username supplied by an MCP client.
export const ALLOWED_GITHUB_USER_ID = 236202359;
export async function verifyGithubIdentity(accessToken, fetchImpl = fetch) {
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 512) {
    throw new Error('Invalid upstream token');
  }
  const response = await fetchImpl('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Easybook-MCP-OAuth'
    },
    redirect: 'error'
  });
  if (!response.ok) {
    console.error('GitHub identity API failure', {status:response.status});
    throw new Error('GitHub identity API unavailable');
  }
  const user = await response.json();
  if (user?.id !== ALLOWED_GITHUB_USER_ID || user?.type !== 'User') {
    console.warn('GitHub identity denied', {expectedId:ALLOWED_GITHUB_USER_ID,receivedId:Number.isSafeInteger(user?.id)?user.id:null,receivedType:user?.type||null});
    throw new Error('GitHub account is not authorized for Easybook');
  }
  return {githubUserId: user.id, login: user.login};
}
