import {READ} from '../../worker/mcp-common.mjs';

// The legacy alias adds read scopes; it must not erase explicit scopes in the
// same request. Validation of supported scope names stays in the caller.
export function requestedScopes(scopes) {
 return [...new Set((scopes.length?scopes:['workspace.read']).flatMap(scope=>scope==='mcp:read'?READ:[scope]))];
}

export function readOnlyConsentNotice(scopes) {
 return scopes.every(scope=>READ.includes(scope))
  ? '<p>此客户端本次仅申请阅读权限。即使你是管理者，也不能在本次授权中增加编辑权限。如需编辑，请从 AI 客户端重新发起包含编辑权限的授权。</p>'
  : '';
}
