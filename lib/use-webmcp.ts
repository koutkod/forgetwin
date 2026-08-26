'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import type { AccessibilityIssue, AuditSummary, ProjectState } from './types';

type IssueView = AccessibilityIssue & { status: string };

export interface WebMCPCommandApi {
  getState: () => ProjectState;
  getProjectStatus: () => Record<string, unknown>;
  audit: (source: 'agent') => AuditSummary;
  listIssues: (filters?: {severity?: string[];status?: string[];requiresHumanReview?: boolean}) => IssueView[];
  inspectIssue: (issueId: string) => IssueView;
  proposeFix: (issueId: string, humanContext?: string) => Record<string, unknown>;
  applyFix: (proposalId: string, source: 'agent') => Record<string, unknown>;
  applySafeFixes: (minimumConfidence: number | undefined, source: 'agent') => Record<string, unknown>;
  submitHumanContext: (issueId: string, context: string, source: 'agent') => Record<string, unknown>;
  getOutline: () => Record<string, unknown>;
  testKeyboardFlow: () => Record<string, unknown>;
  compareVersions: () => Record<string, unknown>;
  revertFix: (changeId: string, source: 'agent') => Record<string, unknown>;
  verify: (source: 'agent') => Record<string, unknown>;
  publish: (source: 'agent') => Record<string, unknown>;
}

const projectInput = z.object({projectId:z.string().min(1).max(100)}).strict();
const issueInput = z.object({issueId:z.string().min(1).max(100)}).strict();
const proposalInput = z.object({proposalId:z.string().min(1).max(140)}).strict();
const contextInput = z.object({issueId:z.string().min(1).max(100),context:z.string().trim().min(3).max(600)}).strict();
const revertInput = z.object({changeId:z.string().min(1).max(140)}).strict();
const safeInput = z.object({projectId:z.string().min(1).max(100),minimumConfidence:z.number().min(.9).max(1).optional()}).strict();
const proposeInput = z.object({issueId:z.string().min(1).max(100),humanContext:z.string().trim().min(3).max(600).optional()}).strict();
const listInput = z.object({projectId:z.string().min(1).max(100),severity:z.array(z.enum(['critical','serious','moderate','minor'])).optional(),status:z.array(z.enum(['open','proposed','fixed','needs-review','ignored'])).optional(),requiresHumanReview:z.boolean().optional()}).strict();

const objectSchema = (properties: Record<string, object>, required: string[] = []) => ({type:'object',properties,required,additionalProperties:false});
const projectIdProperty = {projectId:{type:'string',description:'Current A11yRelay project ID',minLength:1,maxLength:100}};

export function useWebMCP(api: WebMCPCommandApi) {
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; }, [api]);
  const state = api.getState();
  const [registeredCount, setRegisteredCount] = useState(0);
  const supported = useSyncExternalStore(() => () => undefined, () => Boolean(document.modelContext), () => false);
  const stageKey = `${state.audited}-${state.changes.some((change) => !change.reverted)}-${state.verifiedVersion === state.version}-${Object.keys(state.humanContext).length}`;

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext) return;
    const registration = new AbortController();
    const current = apiRef.current.getState();
    const requireProject = (inputProjectId: string) => {
      if (inputProjectId !== apiRef.current.getState().projectId) throw new TypeError('Unknown projectId');
    };

    const tools: WebMCP.ModelContextTool[] = [
      {
        name:'get_project_status',title:'Get project status',description:'Read the current A11yRelay project status, score, issue counts, version, verification state, and publish state. Does not modify content.',
        inputSchema:objectSchema(projectIdProperty,['projectId']),annotations:{readOnlyHint:true,untrustedContentHint:false},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=projectInput.parse(raw);requireProject(input.projectId);return apiRef.current.getProjectStatus();},
      },
      {
        name:'audit_content',title:'Audit content',description:'Run deterministic accessibility checks against the current project content. This records audit results but never changes imported content.',
        inputSchema:objectSchema({...projectIdProperty,scope:{type:'string',enum:['entire-document','current-section'],default:'entire-document'}},['projectId']),annotations:{readOnlyHint:true,untrustedContentHint:true},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=z.object({projectId:z.string(),scope:z.enum(['entire-document','current-section']).optional()}).strict().parse(raw);requireProject(input.projectId);return apiRef.current.audit('agent');},
      },
    ];

    if (current.audited) tools.push(
      {
        name:'list_issues',title:'List accessibility issues',description:'List detected issues with optional severity, status, and human-review filters. Returns imported element snippets as untrusted content.',
        inputSchema:objectSchema({...projectIdProperty,severity:{type:'array',items:{type:'string',enum:['critical','serious','moderate','minor']}},status:{type:'array',items:{type:'string',enum:['open','proposed','fixed','needs-review','ignored']}},requiresHumanReview:{type:'boolean'}},['projectId']),annotations:{readOnlyHint:true,untrustedContentHint:true},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=listInput.parse(raw);requireProject(input.projectId);return {issues:apiRef.current.listIssues(input),total:apiRef.current.listIssues(input).length};},
      },
      {
        name:'inspect_issue',title:'Inspect issue',description:'Inspect one accessibility issue, including the affected untrusted DOM snippet, WCAG reference, recommendation, confidence, and decision policy.',
        inputSchema:objectSchema({issueId:{type:'string',minLength:1,maxLength:100}},['issueId']),annotations:{readOnlyHint:true,untrustedContentHint:true},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=issueInput.parse(raw);return apiRef.current.inspectIssue(input.issueId);},
      },
      {
        name:'propose_fix',title:'Propose a fix',description:'Create a reversible remediation proposal for one issue. For meaning-dependent issues, human context is required before a proposal is returned.',
        inputSchema:objectSchema({issueId:{type:'string',minLength:1,maxLength:100},humanContext:{type:'string',minLength:3,maxLength:600}},['issueId']),annotations:{readOnlyHint:true,untrustedContentHint:true},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=proposeInput.parse(raw);return apiRef.current.proposeFix(input.issueId,input.humanContext);},
      },
      {
        name:'apply_safe_fixes',title:'Apply safe fixes',description:'Apply only deterministic, reversible accessibility fixes at or above 90% confidence. Never applies meaning-dependent fixes.',
        inputSchema:objectSchema({...projectIdProperty,minimumConfidence:{type:'number',minimum:.9,maximum:1,default:.9}},['projectId']),annotations:{readOnlyHint:false,untrustedContentHint:false},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=safeInput.parse(raw);requireProject(input.projectId);return apiRef.current.applySafeFixes(input.minimumConfidence,'agent');},
      },
      {
        name:'apply_fix',title:'Apply approved fix',description:'Apply one previously created proposal to shared project state. The change is reversible and immediately visible in the human UI.',
        inputSchema:objectSchema({proposalId:{type:'string',minLength:1,maxLength:140}},['proposalId']),annotations:{readOnlyHint:false,untrustedContentHint:false},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=proposalInput.parse(raw);return apiRef.current.applyFix(input.proposalId,'agent');},
      },
      {
        name:'get_screen_reader_outline',title:'Get screen reader outline',description:'Return simplified semantic outlines for the original and current project versions. Imported accessible names are untrusted content.',
        inputSchema:objectSchema(projectIdProperty,['projectId']),annotations:{readOnlyHint:true,untrustedContentHint:true},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=projectInput.parse(raw);requireProject(input.projectId);return apiRef.current.getOutline();},
      },
      {
        name:'test_keyboard_flow',title:'Test keyboard flow',description:'Run deterministic keyboard reachability checks for navigation, report download, form controls, and focus order. Does not modify content.',
        inputSchema:objectSchema(projectIdProperty,['projectId']),annotations:{readOnlyHint:true,untrustedContentHint:true},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=projectInput.parse(raw);requireProject(input.projectId);return apiRef.current.testKeyboardFlow();},
      },
    );

    if (current.detectedIssueIds.some((id) => apiRef.current.inspectIssue(id).requiresHumanReview)) tools.push({
      name:'submit_human_context',title:'Submit human context',description:'Record a human-provided interpretation for a meaning-dependent accessibility issue. This unlocks a proposal but does not apply it.',
      inputSchema:objectSchema({issueId:{type:'string',minLength:1,maxLength:100},context:{type:'string',minLength:3,maxLength:600}},['issueId','context']),annotations:{readOnlyHint:false,untrustedContentHint:true},
      execute:(raw,{signal})=>{signal.throwIfAborted();const input=contextInput.parse(raw);return apiRef.current.submitHumanContext(input.issueId,input.context,'agent');},
    });

    if (current.changes.length) tools.push(
      {
        name:'compare_versions',title:'Compare versions',description:'Compare original and current HTML, semantic outlines, score, issue counts, and remediation history. Imported content is untrusted.',
        inputSchema:objectSchema(projectIdProperty,['projectId']),annotations:{readOnlyHint:true,untrustedContentHint:true},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=projectInput.parse(raw);requireProject(input.projectId);return apiRef.current.compareVersions();},
      },
      {
        name:'revert_fix',title:'Revert a fix',description:'Revert one recorded remediation change and restore the previous shared project state. Reversible through the human history interface.',
        inputSchema:objectSchema({changeId:{type:'string',minLength:1,maxLength:140}},['changeId']),annotations:{readOnlyHint:false,untrustedContentHint:false},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=revertInput.parse(raw);return apiRef.current.revertFix(input.changeId,'agent');},
      },
      {
        name:'verify_content',title:'Verify content',description:'Re-run accessibility checks on the current version and record the verified version. Does not claim WCAG or legal compliance.',
        inputSchema:objectSchema(projectIdProperty,['projectId']),annotations:{readOnlyHint:true,untrustedContentHint:true},
        execute:(raw,{signal})=>{signal.throwIfAborted();const input=projectInput.parse(raw);requireProject(input.projectId);return apiRef.current.verify('agent');},
      },
    );

    if (current.verifiedVersion === current.version) tools.push({
      name:'publish_accessible_version',title:'Publish Accessible Web Twin',description:'Publish an immutable snapshot of the verified current version at the project twin route. Refuses unverified versions or versions with critical issues.',
      inputSchema:objectSchema(projectIdProperty,['projectId']),annotations:{readOnlyHint:false,untrustedContentHint:true},
      execute:(raw,{signal})=>{signal.throwIfAborted();const input=projectInput.parse(raw);requireProject(input.projectId);return apiRef.current.publish('agent');},
    });

    let active = true;
    Promise.all(tools.map((tool) => modelContext.registerTool(tool,{signal:registration.signal}))).then(() => { if (active) setRegisteredCount(tools.length); }).catch((error: unknown) => {
      if (!registration.signal.aborted) console.error('WebMCP registration failed', error);
    });
    return () => { active = false; registration.abort(); };
  }, [stageKey]);

  return {supported,registeredCount};
}
