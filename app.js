const stages = [
  {name:'提交标准提案',short:'提案',owner:'申报单位',duration:'提交后进入形式审核',materials:['团体标准提案申请表','项目可行性研究报告'],requirements:['填写项目基本信息','说明制定目的和必要性','上传盖章提案材料']},
  {name:'形式审核',short:'形式审核',owner:'标准化技术委员会办公室',duration:'受理后及时办理',materials:['提案材料','形式审核意见'],requirements:['检查材料完整性','核对协会业务范围','不通过可进入培育修改'],review:true,branch:'不通过 → 入库培育 → 修改完善 → 重新提交'},
  {name:'立项申报',short:'立项申报',owner:'申报单位',duration:'按通知期限提交',materials:['团体标准制修订立项申请书','标准草案'],requirements:['明确牵头与参编单位','提出初步技术框架','明确经费和工作计划']},
  {name:'签订协议',short:'签订协议',owner:'协会与申报单位',duration:'立项论证前完成',materials:['团体标准项目技术服务协议','合同审批材料'],requirements:['确认双方职责','明确周期和成果','完成盖章归档']},
  {name:'组织专家立项论证',short:'立项论证',owner:'协会秘书处 / 专家组',duration:'专家一般不少于 7 人',materials:['论证会通知','会议手册','专家意见','会议纪要'],requirements:['专家构成符合要求','对必要性与可行性论证','形成通过或不通过结论'],review:true,branch:'不通过 → 修改完善 → 重新组织论证'},
  {name:'下达立项计划',short:'立项计划',owner:'中国灾害防御协会',duration:'论证通过后下达',materials:['立项公告','标准制定计划通知'],requirements:['全国团体标准信息平台公示','协会官网发布立项信息','生成正式计划编号']},
  {name:'填报项目任务书',short:'任务书',owner:'标准起草组',duration:'立项后及时填报',materials:['团体标准制修订项目任务书','启动会材料'],requirements:['细化工作任务和节点','明确成员与职责','填写计划进度']},
  {name:'标准起草',short:'起草',owner:'标准起草组',duration:'一般项目周期 12 个月',materials:['标准草案','编制说明','调研与验证材料'],requirements:['按标准编写规则起草','说明主要技术指标依据','保留历次修改记录']},
  {name:'征求意见',short:'征求意见',owner:'协会秘书处 / 标委会',duration:'公开征求不少于 30 日',materials:['标准征求意见稿','编制说明','征求意见通知','反馈意见'],requirements:['公开期限不少于 30 日','覆盖相关单位和专家','完整记录回函情况']},
  {name:'标准修改',short:'标准修改',owner:'标准起草组',duration:'征求意见结束后',materials:['征求意见汇总处理表','标准送审稿','编制说明（送审稿）'],requirements:['逐条处理反馈意见','未采纳意见说明理由','形成送审材料']},
  {name:'技术审查',short:'技术审查',owner:'标委会 / 审查专家组',duration:'审查专家一般不超过 9 人',materials:['技术审查会通知','标准送审稿','技术审查意见','专家签字表','会议纪要'],requirements:['到会人数符合规定','通过须不少于四分之三同意','起草人员回避表决'],review:true,branch:'不通过 → 退回标准修改 → 再次技术审查'},
  {name:'标准定稿',short:'报批定稿',owner:'起草组 / 协会秘书处',duration:'审查通过后',materials:['标准报批稿','编制说明（报批稿）','意见处理材料','报批稿函'],requirements:['落实全部审查意见','复核文本和材料完整性','提交报批材料']},
  {name:'标准编号',short:'编号',owner:'中国灾害防御协会',duration:'报批复核通过后',materials:['标准编号登记','发布审批材料'],requirements:['按 T/CADP 规则编号','确定发布和实施日期','完成内部审批']},
  {name:'标准发布',short:'发布',owner:'中国灾害防御协会',duration:'协会文件形式发布',materials:['标准发布公告','团体标准正式文本'],requirements:['全国平台公开标准信息','协会官网同步发布','归档公告和正式文本']},
  {name:'标准出版',short:'出版',owner:'中国灾害防御协会',duration:'发布后安排',materials:['标准出版稿','正式出版物'],requirements:['核对出版稿一致性','记录出版版本','转入实施与复审管理']}
];

const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const clone=value=>JSON.parse(JSON.stringify(value));
const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||clone(fallback)}catch{return clone(fallback)}};
const save=(key,value)=>{if(!backendEnabled)localStorage.setItem(key,JSON.stringify(value))};

let projects=load('cadp-projects-v3',seedProjects);
let missingItems=load('cadp-missing-v2',seedMissing);
let roadmap=load('cadp-roadmap-v2',roadmapSeed);
let standards=clone(publishedStandards);
let documents=[];
let activities=load('cadp-activities-v2',[
  {time:'2026-08-13 10:20',project:'材料导入',action:'扫描 62 个项目目录并导入重点项目',operator:'系统',result:'已完成'},
  {time:'2026-08-13 10:10',project:'正式标准库',action:'导入已发布团体标准 33 项',operator:'系统',result:'已完成'}
]);
let selectedProject=projects[0];
let selectedStage=selectedProject.current;
let uploadMissingId=null;
let backendEnabled=false;
let currentUser=null;

async function apiRequest(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body instanceof Blob||options.body instanceof File?{}:{'Content-Type':'application/json'}),...(options.headers||{})}});
  const type=response.headers.get('content-type')||'';
  const payload=type.includes('application/json')?await response.json():null;
  if(!response.ok){const error=new Error(payload?.error||`请求失败（${response.status}）`);error.status=response.status;if(response.status===401&&path!=='/api/login')queueMicrotask(()=>showLogin(error.message));throw error}
  return payload;
}

function setConnection(mode,text){
  const state=$('#saveState');state.classList.remove('demo','error','syncing');if(mode)state.classList.add(mode);$('#saveStateText').textContent=text;
}

function applyBootstrap(data,preferredProjectId=selectedProject?.id){
  projects=data.projects;missingItems=data.missingItems;roadmap=data.roadmap;activities=data.activities;standards=data.publishedStandards;documents=data.documents||[];currentUser=data.user;
  selectedProject=projects.find(project=>project.id===preferredProjectId)||projects[0];selectedStage=selectedProject?.current||1;
  $('#currentUserName').textContent=currentUser?.displayName||'系统管理员';$('#currentUserRole').textContent=currentUser?.role==='admin'?'协会管理员':'系统用户';$('#logoutButton').hidden=false;
}

async function syncFromBackend(preferredProjectId=selectedProject?.id){
  setConnection('syncing','正在同步');
  const data=await apiRequest('/api/bootstrap');
  backendEnabled=true;applyBootstrap(data,preferredProjectId);setConnection('','数据库已同步');
  return data;
}

function showLogin(message=''){
  setConnection('error','等待登录');$('#loginError').textContent=message;
  if(!$('#loginDialog').open)$('#loginDialog').showModal();
}

function renderAll(){buildFilters();renderDashboard();renderProjectTable();renderMissing();renderSystem();renderActivities()}

async function initialize(){
  renderAll();
  setConnection('syncing','正在连接数据');
  try{await syncFromBackend();renderAll()}
  catch(error){
    if(error.status===401){showLogin();return}
    backendEnabled=false;setConnection('demo','演示模式 · 本地保存');
  }
}

function showToast(message,title='操作成功'){
  const toast=$('#toast'); $('strong',toast).textContent=title; $('#toastMessage').textContent=message;
  toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>toast.classList.remove('show'),2200);
}

function addActivity(project,action,result='已完成'){
  if(backendEnabled)return;
  activities.unshift({time:new Date().toLocaleString('zh-CN',{hour12:false}).replaceAll('/','-'),project,action,operator:'系统管理员',result});
  activities=activities.slice(0,50); save('cadp-activities-v2',activities); renderActivities();
}

function progressFor(project){return Math.round(Math.min(100,project.current/stages.length*100))}
function projectMissing(projectId){return missingItems.filter(item=>item.projectId===projectId&&item.state==='open')}

function navigate(page){
  $$('.page').forEach(view=>view.classList.toggle('active',view.dataset.pageView===page));
  $$('.nav-item[data-page]').forEach(item=>item.classList.toggle('active',item.dataset.page===page));
  $('#breadcrumb').textContent=$(`.nav-item[data-page="${page}"] span:last-of-type`)?.textContent||'工作台';
  $('#sidebar').classList.remove('open');
  if(page==='dashboard')renderDashboard();
  if(page==='projects')renderProjectTable();
  if(page==='workflow')renderWorkflow();
  if(page==='missing')renderMissing();
  if(page==='system')renderSystem();
  window.scrollTo({top:0,behavior:'smooth'});
}

function updateCounts(){
  const open=missingItems.filter(item=>item.state==='open').length;
  $('#missingCount').textContent=open; $('#missingNavCount').textContent=open; $('#projectNavCount').textContent=projects.length;
  $('#activeProjectCount').textContent=projects.filter(project=>project.status==='在研').length;
}

function renderDashboard(){
  updateCounts();
  const focus=[...projects].filter(p=>p.status==='在研').sort((a,b)=>(b.current-a.current)||(projectMissing(b.id).length-projectMissing(a.id).length)).slice(0,6);
  $('#dashboardProjects').innerHTML=focus.map((project,index)=>`<button class="dashboard-project" data-focus="${project.id}"><span class="index">${String(index+1).padStart(2,'0')}</span><span class="project-main"><strong>${h(project.name)}</strong><small>${h(stages[project.current-1].name)} · ${h(project.owner)}</small><i><b style="width:${progressFor(project)}%"></b></i></span><span class="project-side"><strong>${progressFor(project)}%</strong><small class="${projectMissing(project.id).length?'warn':''}">${projectMissing(project.id).length?`${projectMissing(project.id).length} 项待确认`:'材料正常'}</small></span></button>`).join('');
  $$('[data-focus]').forEach(button=>button.addEventListener('click',()=>openWorkflow(Number(button.dataset.focus))));
  const topMissing=missingItems.filter(item=>item.state==='open').slice(0,5);
  $('#taskCount').textContent=topMissing.length;
  $('#taskList').innerHTML=topMissing.map(item=>{const project=projects.find(p=>p.id===item.projectId);return `<button class="task-line" data-missing-link="${item.id}"><span>!</span><div><strong>${h(item.material)}</strong><small>${h(project?.name||'未知项目')} · ${h(item.category)}</small></div><em>待确认</em></button>`}).join('')||'<div class="empty-state">暂无待处理材料</div>';
  $$('[data-missing-link]').forEach(button=>button.addEventListener('click',()=>navigate('missing')));
  $('#compactFlow').innerHTML=`<div class="compact-flow-line">${stages.map((stage,index)=>`${index?'<b></b>':''}<div class="compact-step ${index<7?'done':index===7?'active':''}"><i>${index<7?'✓':index+1}</i><strong>${stage.short}</strong></div>`).join('')}</div>`;
}

function buildFilters(){
  const names=[...new Set(stages.map(s=>s.name))];
  $('#statusFilter').innerHTML='<option value="all">全部环节</option>'+names.map(n=>`<option>${n}</option>`).join('');
  $('#missingStageFilter').innerHTML='<option value="all">全部环节</option>'+[...new Set(missingItems.map(i=>i.category))].map(n=>`<option>${n}</option>`).join('');
  $('#editStageSelect').innerHTML=stages.map((s,i)=>`<option value="${i+1}">${i+1}. ${s.name}</option>`).join('');
}

function renderProjectTable(){
  updateCounts();
  const query=$('#projectSearch').value.trim().toLowerCase(); const status=$('#statusFilter').value;
  const filtered=projects.filter(p=>(status==='all'||stages[p.current-1].name===status)&&`${p.name}${p.code}${p.owner}`.toLowerCase().includes(query));
  $('#projectRows').innerHTML=filtered.map(project=>`<div class="table-row"><span class="project-name"><i>标</i><span><strong>${h(project.name)}</strong><small>${h(project.code||'暂未编号')} · ${project.files||0} 个目录文件</small></span></span><span><i class="project-status">${h(stages[project.current-1].name)}</i></span><span>${h(project.owner||'待补充')}</span><span><b class="material-count ${projectMissing(project.id).length?'has-missing':''}">${projectMissing(project.id).length?`${projectMissing(project.id).length} 待确认`:'完整'}</b></span><span>${progressFor(project)}%</span><span class="row-actions"><button data-open="${project.id}">办理</button><button data-edit="${project.id}">修改</button></span></div>`).join('')||'<div class="empty-state">没有找到符合条件的项目</div>';
  $$('[data-open]').forEach(button=>button.addEventListener('click',()=>openWorkflow(Number(button.dataset.open))));
  $$('[data-edit]').forEach(button=>button.addEventListener('click',()=>openEdit(Number(button.dataset.edit))));
}

function openWorkflow(id){selectedProject=projects.find(p=>p.id===id)||projects[0];selectedStage=selectedProject.current;navigate('workflow')}

function renderProjectMenu(){
  $('#projectMenu').innerHTML=projects.map(p=>`<button data-project-id="${p.id}"><strong>${h(p.name)}</strong><small>${h(stages[p.current-1].name)} · ${h(p.code||'暂未编号')}</small></button>`).join('');
  $$('#projectMenu button').forEach(button=>button.addEventListener('click',()=>{selectedProject=projects.find(p=>p.id===Number(button.dataset.projectId));selectedStage=selectedProject.current;$('#projectMenu').classList.remove('open');renderWorkflow()}));
}

function renderWorkflow(){
  if(!selectedProject)selectedProject=projects[0];
  const progress=progressFor(selectedProject);
  $('#selectedProjectName').textContent=selectedProject.name; $('#selectedProjectCode').textContent=selectedProject.code||'暂未编号';
  $('#currentStageText').textContent=stages[selectedProject.current-1].name; $('#dueDateText').textContent=selectedProject.due||'待确定';
  $('#ownerText').textContent=selectedProject.owner||'待补充'; $('#progressText').textContent=`${progress}%`; $('#progressBar').style.width=`${progress}%`;
  $('#advanceStage').disabled=selectedProject.current>=stages.length||selectedProject.status==='已发布';
  $('#advanceStage').textContent=selectedProject.current>=stages.length?'流程已完成':'完成当前环节';
  renderProjectMenu(); renderPhaseStrip(); renderFlowBoard(); renderStageDetail(); renderActivities();
}

function renderPhaseStrip(){
  const phases=[['提案与立项',1,6],['标准研制',7,10],['审查与报批',11,13],['发布出版',14,15]];
  $('#phaseStrip').innerHTML=phases.map(p=>`<span class="${selectedStage>=p[1]&&selectedStage<=p[2]?'active':''}">${p[0]} · ${p[1]}—${p[2]}</span>`).join('');
}

function renderFlowBoard(){
  $('#flowBoard').innerHTML=stages.map((stage,index)=>{const number=index+1,state=number<selectedProject.current?'done':number===selectedProject.current?'active':'',selected=number===selectedStage?'selected':'',open=missingItems.filter(i=>i.projectId===selectedProject.id&&i.stage===number&&i.state==='open').length;return `<div class="flow-row"><button class="flow-node ${state} ${selected} ${stage.review?'diamond':''}" data-stage="${number}"><span class="node-number">${state==='done'?'✓':number}</span><span><strong>${stage.name}</strong><small>${stage.owner}</small></span>${open?`<em class="node-missing">缺 ${open}</em>`:`<em class="node-state">${state==='done'?'已完成':state==='active'?'进行中':'待开始'}</em>`}</button>${stage.branch?`<div class="branch-line right"></div><div class="resource-card right branch">${stage.branch}</div>`:''}</div>`}).join('');
  $$('.flow-node').forEach(node=>node.addEventListener('click',()=>{selectedStage=Number(node.dataset.stage);renderPhaseStrip();renderFlowBoard();renderStageDetail()}));
}

function renderStageDetail(){
  const stage=stages[selectedStage-1],isDone=selectedStage<selectedProject.current,isActive=selectedStage===selectedProject.current;
  const missingAtStage=missingItems.filter(i=>i.projectId===selectedProject.id&&i.stage===selectedStage&&i.state==='open');
  const stageDocuments=documents.filter(item=>item.projectId===selectedProject.id&&item.stage===selectedStage);
  const originalNotes=selectedProject.notes;selectedProject.notes=h(originalNotes||'暂无备注');
  $('#stageDetail').innerHTML=`<div class="detail-cover"><div class="detail-topline"><span class="step-label">STEP ${String(selectedStage).padStart(2,'0')} / 15</span><span class="stage-badge">${isDone?'已完成':isActive?'办理中':'待开始'}</span></div><h2>${stage.name}</h2><p>${stage.owner} · ${stage.duration}</p></div><div class="detail-body"><section class="detail-section"><h3>所需材料</h3>${stage.materials.map(material=>{const isMissing=missingAtStage.some(i=>material.includes(i.material)||i.material.includes(material));return `<div class="material-item ${isMissing?'missing-material':''}"><span class="material-icon">${isMissing?'!':'W'}</span><div><strong>${material}</strong><small>${isMissing?'目录中未识别到，需确认':isDone?'已完成环节材料':'按节点准备'}</small></div>${isMissing?'<button data-jump-missing>补充</button>':'<button data-preview>查看</button>'}</div>`}).join('')}</section><section class="detail-section"><h3>办理要求</h3><ul class="requirement-list">${stage.requirements.map(r=>`<li>${r}</li>`).join('')}</ul>${stage.branch?`<div class="branch-note"><strong>退回路径</strong>${stage.branch}</div>`:''}</section><section class="detail-section"><h3>项目备注</h3><p class="project-note">${selectedProject.notes||'暂无备注'}</p></section><div class="detail-actions">${stage.review&&isActive?'<button class="danger-button" id="returnStage">退回修改</button>':''}<button class="primary" id="detailAction">${isActive?'办理当前环节':'查看记录'}</button></div></div>`;
  selectedProject.notes=originalNotes;
  if(stageDocuments.length){const section=document.createElement('section');section.className='detail-section';section.innerHTML=`<h3>已归档文件</h3><div class="file-list">${stageDocuments.map(file=>`<a class="file-link" href="${h(file.downloadUrl)}"><span>▤ ${h(file.name)}</span><small>${h(file.createdAt)}</small></a>`).join('')}</div>`;$('.detail-actions',$('#stageDetail')).before(section)}
  $$('[data-jump-missing]').forEach(b=>b.addEventListener('click',()=>navigate('missing'))); $$('[data-preview]').forEach(b=>b.addEventListener('click',()=>showToast('文件预览将在正式文件存储接入后启用')));
  $('#detailAction').addEventListener('click',()=>showToast(isActive?'已打开当前环节办理信息':'办理记录已显示'));
  if($('#returnStage'))$('#returnStage').addEventListener('click',async()=>{
    const target=selectedProject.current===11?10:Math.max(1,selectedProject.current-1),projectId=selectedProject.id;
    try{
      if(backendEnabled){await apiRequest(`/api/projects/${projectId}/return`,{method:'POST',body:JSON.stringify({target})});await syncFromBackend(projectId)}
      else{selectedProject.current=target;selectedStage=target;save('cadp-projects-v3',projects);addActivity(selectedProject.name,`退回至“${stages[target-1].name}”`,'已退回')}
      selectedStage=target;renderWorkflow();renderDashboard();showToast('项目已退回修改','已退回');
    }catch(error){showToast(error.message,'退回失败')}
  });
}

function renderActivities(){
  $('#activityRows').innerHTML=activities.map(row=>`<div class="table-row"><span>${h(row.time)}</span><span>${h(row.project)}</span><span>${h(row.action)}</span><span>${h(row.operator)}</span><span><i class="result-tag ${row.result==='已退回'?'returned':''}">${h(row.result)}</i></span></div>`).join('')||'<div class="empty-state">暂无办理记录</div>';
}

function renderMissing(){
  updateCounts(); const q=$('#missingSearch').value.trim().toLowerCase(),stage=$('#missingStageFilter').value,state=$('#missingStateFilter').value;
  const filtered=missingItems.filter(item=>(state==='all'||item.state===state)&&(stage==='all'||item.category===stage)&&`${item.material}${projects.find(p=>p.id===item.projectId)?.name||''}`.toLowerCase().includes(q));
  $('#missingList').innerHTML=filtered.map(item=>{const project=projects.find(p=>p.id===item.projectId);return `<div class="missing-item ${item.state!=='open'?'closed':''}"><span class="missing-icon">${item.state==='open'?'!':item.state==='resolved'?'✓':'—'}</span><div class="missing-main"><div><strong>${h(item.material)}</strong><i class="project-status">${h(item.category)}</i></div><p>${h(project?.name||'未知项目')}</p><small>${h(item.filename||item.source)} · ${item.state==='open'?'待人工确认':item.state==='resolved'?'已补充':'已忽略误报'}</small></div><div class="missing-actions">${item.state==='open'?`<button class="primary" data-upload="${item.id}">补充文件</button><button class="secondary" data-ignore="${item.id}">忽略误报</button>`:`<button class="secondary" data-reopen="${item.id}">重新打开</button>`}<button class="text-button" data-project="${item.projectId}">查看项目</button></div></div>`}).join('')||'<div class="empty-state">没有符合条件的待补材料</div>';
  $$('[data-upload]').forEach(b=>b.addEventListener('click',()=>openUpload(Number(b.dataset.upload))));
  $$('[data-ignore]').forEach(b=>b.addEventListener('click',()=>updateMissing(Number(b.dataset.ignore),'ignored')));
  $$('[data-reopen]').forEach(b=>b.addEventListener('click',()=>updateMissing(Number(b.dataset.reopen),'open')));
  $$('[data-project]').forEach(b=>b.addEventListener('click',()=>openWorkflow(Number(b.dataset.project))));
}

async function updateMissing(id,state){
  const item=missingItems.find(i=>i.id===id);if(!item)return;
  try{
    if(backendEnabled){await apiRequest(`/api/missing/${id}`,{method:'PATCH',body:JSON.stringify({state})});await syncFromBackend()}
    else{item.state=state;save('cadp-missing-v2',missingItems);addActivity(projects.find(p=>p.id===item.projectId)?.name||'项目',`${item.material}：${state==='ignored'?'忽略误报':state==='resolved'?'补充完成':'重新打开'}`)}
    buildFilters();renderMissing();renderDashboard();showToast(state==='ignored'?'已忽略该条自动判断':state==='resolved'?'材料已标记补充':'已重新打开');
  }catch(error){showToast(error.message,'操作未完成')}
}
function openUpload(id){uploadMissingId=id;const item=missingItems.find(i=>i.id===id);$('#uploadTitle').textContent=`补充：${item.material}`;$('#missingSelectedFile').textContent='';$('#missingFile').value='';$('#uploadDialog').showModal()}

function categoryFor(name){if(/航空|直升机|无人机/.test(name))return'航空与低空救援';if(/地震|滑坡|地质|泥石流|矿山/.test(name))return'地震地质灾害';if(/洪|旱|气象/.test(name))return'洪涝气象灾害';if(/建筑|房屋|燃气/.test(name))return'建筑与城市安全';if(/应急|救援|物资|食品|装备|机器人/.test(name))return'应急救援与保障';return'综合防灾减灾'}

function renderSystem(){
  $('#systemLayers').innerHTML=systemLayers.map(layer=>`<div class="system-layer"><span>${layer[0]}</span><div><strong>${layer[1]}</strong><p>${layer[2]}</p><small>${layer[3]}</small></div></div>`).join('');
  $('#roadmapCount').textContent=`${roadmap.filter(r=>!r.done).length} 项待办`;
  $('#roadmapList').innerHTML=roadmap.map(item=>`<label class="roadmap-item"><input type="checkbox" data-roadmap="${item.id}" ${item.done?'checked':''}><span></span><div><strong>${h(item.title)}</strong><small>${h(item.owner)} · 计划 ${h(item.due)}</small></div></label>`).join('');
  $$('[data-roadmap]').forEach(input=>input.addEventListener('change',async()=>{
    const id=Number(input.dataset.roadmap),item=roadmap.find(r=>r.id===id),done=input.checked;
    try{if(backendEnabled){await apiRequest(`/api/roadmap/${id}`,{method:'PATCH',body:JSON.stringify({done})});await syncFromBackend()}else{item.done=done;save('cadp-roadmap-v2',roadmap)}renderSystem();showToast(done?'体系任务已完成':'体系任务已恢复')}catch(error){input.checked=!done;showToast(error.message,'保存失败')}
  }));
  renderStandardRows();
}

function renderStandardRows(){const q=$('#standardSearch').value.trim().toLowerCase();const list=standards.filter(s=>`${s[0]}${s[1]}`.toLowerCase().includes(q));$('#standardRows').innerHTML=list.map(s=>`<div class="table-row"><span><strong>${h(s[0])}</strong></span><span>${h(s[1])}</span><span>${h(s[0].slice(-4))}</span><span><i class="project-status">${h(categoryFor(s[1]))}</i></span></div>`).join('')}

function openEdit(id){const project=projects.find(p=>p.id===id),form=$('#editProjectForm');Object.entries(project).forEach(([key,value])=>{if(form.elements[key])form.elements[key].value=value??''});$('#editDialog').showModal()}

function downloadCsv(filename,rows){const csv='\ufeff'+rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);showToast(`${filename} 已导出`)}

$$('.nav-item[data-page]').forEach(item=>item.addEventListener('click',()=>navigate(item.dataset.page)));
$$('[data-go]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.go)));
$$('[data-new-project]').forEach(button=>button.addEventListener('click',()=>{$('#newProjectForm').reset();$('#projectDialog').showModal()}));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#projectSelectButton').addEventListener('click',()=>$('#projectMenu').classList.toggle('open'));
$('#projectSearch').addEventListener('input',renderProjectTable); $('#statusFilter').addEventListener('change',renderProjectTable);
$('#missingSearch').addEventListener('input',renderMissing); $('#missingStageFilter').addEventListener('change',renderMissing); $('#missingStateFilter').addEventListener('change',renderMissing);
$('#standardSearch').addEventListener('input',renderStandardRows);
$$('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>$('#projectDialog').close())); $$('[data-close-edit]').forEach(b=>b.addEventListener('click',()=>$('#editDialog').close())); $$('[data-close-upload]').forEach(b=>b.addEventListener('click',()=>$('#uploadDialog').close()));
$('#newProjectForm').addEventListener('submit',async event=>{
  event.preventDefault();const d=Object.fromEntries(new FormData(event.target)),button=$('button[type="submit"]',event.target);button.classList.add('button-busy');
  try{
    if(backendEnabled){const result=await apiRequest('/api/projects',{method:'POST',body:JSON.stringify(d)});await syncFromBackend(result.project.id)}
    else{const project={id:Date.now(),name:d.name,code:d.code||'提案项目',owner:d.owner,due:d.due,current:1,status:'在研',files:0,notes:d.notes};projects.unshift(project);save('cadp-projects-v3',projects);selectedProject=project;selectedStage=1;addActivity(project.name,'创建项目并进入提案环节')}
    $('#projectDialog').close();buildFilters();renderDashboard();navigate('workflow');showToast('新项目已创建');
  }catch(error){showToast(error.message,'创建失败')}finally{button.classList.remove('button-busy')}
});
$('#editProjectForm').addEventListener('submit',async event=>{
  event.preventDefault();const d=Object.fromEntries(new FormData(event.target)),id=Number(d.id),project=projects.find(p=>p.id===id),button=$('button[type="submit"]',event.target);button.classList.add('button-busy');
  try{
    if(backendEnabled){await apiRequest(`/api/projects/${id}`,{method:'PUT',body:JSON.stringify(d)});await syncFromBackend(id)}
    else{Object.assign(project,{name:d.name,code:d.code,owner:d.owner,due:d.due,current:Number(d.current),status:d.status,notes:d.notes});save('cadp-projects-v3',projects);if(selectedProject.id===project.id){selectedProject=project;selectedStage=project.current}addActivity(project.name,'修改项目基本信息')}
    $('#editDialog').close();renderProjectTable();renderDashboard();showToast('项目信息已保存');
  }catch(error){showToast(error.message,'保存失败')}finally{button.classList.remove('button-busy')}
});
$('#advanceStage').addEventListener('click',async()=>{
  if(selectedProject.current>=stages.length)return;const projectId=selectedProject.id,before=stages[selectedProject.current-1].name;$('#advanceStage').classList.add('button-busy');
  try{
    if(backendEnabled){await apiRequest(`/api/projects/${projectId}/advance`,{method:'POST',body:'{}'});await syncFromBackend(projectId)}
    else{selectedProject.current+=1;selectedStage=selectedProject.current;if(selectedProject.current===stages.length)selectedProject.status='已发布';save('cadp-projects-v3',projects);addActivity(selectedProject.name,`完成“${before}”，进入“${stages[selectedProject.current-1].name}”`)}
    renderWorkflow();renderDashboard();showToast('已推进到下一环节');
  }catch(error){showToast(error.message,'流程推进失败')}finally{$('#advanceStage').classList.remove('button-busy')}
});
$('#missingFile').addEventListener('change',e=>{$('#missingSelectedFile').textContent=e.target.files[0]?`已选择：${e.target.files[0].name}`:''});
$('#confirmUpload').addEventListener('click',async()=>{
  const file=$('#missingFile').files[0];if(!file){showToast('请先选择文件','尚未选择');return}if(file.size>30*1024*1024){showToast('单个文件不能超过 30 MB','文件过大');return}
  const item=missingItems.find(i=>i.id===uploadMissingId),button=$('#confirmUpload');button.classList.add('button-busy');
  try{
    if(backendEnabled){await apiRequest(`/api/missing/${uploadMissingId}/upload?filename=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});await syncFromBackend(item.projectId)}
    else{item.filename=file.name;await updateMissing(uploadMissingId,'resolved')}
    $('#uploadDialog').close();renderMissing();renderWorkflow();showToast('材料已上传并归档');
  }catch(error){showToast(error.message,'上传失败')}finally{button.classList.remove('button-busy')}
});
$('#clearActivities').addEventListener('click',async()=>{
  try{if(backendEnabled){await apiRequest('/api/activities',{method:'DELETE',body:'{}'});await syncFromBackend()}else{activities=[];save('cadp-activities-v2',activities)}renderActivities();showToast('办理记录已清理')}catch(error){showToast(error.message,'清理失败')}
});
$('#exportProjects').addEventListener('click',()=>downloadCsv('团体标准项目台账.csv',[['标准名称','项目编号','牵头单位','当前环节','状态','计划完成','待补材料数'],...projects.map(p=>[p.name,p.code,p.owner,stages[p.current-1].name,p.status,p.due,projectMissing(p.id).length])]));
$('#exportMissing').addEventListener('click',()=>downloadCsv('团体标准待补材料清单.csv',[['项目名称','当前环节','待补材料','类别','处理状态','判断依据'],...missingItems.map(i=>[projects.find(p=>p.id===i.projectId)?.name,stages[i.stage-1]?.name,i.material,i.category,i.state,i.source])]));
$('#addSystemItem').addEventListener('click',async()=>{const title=prompt('请输入体系建设任务：');if(!title)return;try{if(backendEnabled){await apiRequest('/api/roadmap',{method:'POST',body:JSON.stringify({title})});await syncFromBackend()}else{roadmap.push({id:Date.now(),title,owner:'待指定',due:'待确定',done:false});save('cadp-roadmap-v2',roadmap)}renderSystem();showToast('体系任务已添加')}catch(error){showToast(error.message,'添加失败')}});
$('#globalSearchButton').addEventListener('click',()=>{navigate('projects');$('#projectSearch').focus()});
document.addEventListener('click',event=>{if(!event.target.closest('.project-selector'))$('#projectMenu').classList.remove('open')});
$('#loginDialog').addEventListener('cancel',event=>event.preventDefault());
$('#loginForm').addEventListener('submit',async event=>{
  event.preventDefault();const d=Object.fromEntries(new FormData(event.target)),button=$('button[type="submit"]',event.target);button.classList.add('button-busy');$('#loginError').textContent='';
  try{await apiRequest('/api/login',{method:'POST',body:JSON.stringify(d)});await syncFromBackend();$('#loginDialog').close();renderAll();showToast('已连接统一数据库','登录成功')}
  catch(error){showLogin(error.message)}finally{button.classList.remove('button-busy')}
});
$('#logoutButton').addEventListener('click',async()=>{
  try{await apiRequest('/api/logout',{method:'POST',body:'{}'})}catch{}
  backendEnabled=false;currentUser=null;$('#logoutButton').hidden=true;showLogin('已安全退出');
});

initialize();
