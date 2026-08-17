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
const documentCategories=['标准文本','编制说明','意见征集与处理','审查与专家材料','立项与任务','合同与费用','报批与审批','发布与证书','支撑证明材料','其他材料'];

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
let users=[];
let backups=[];
let ledgerRecords=[];
let annualPlans=[];
let ledgerSummary={records:0,published:0,plans:0,linked:0};
let analyticsData={standardsByYear:[]};
let permissions={manageProjects:true,manageUsers:false,manageBackups:false};
let activities=load('cadp-activities-v2',[
  {time:'2026-08-13 10:20',project:'材料导入',action:'扫描 62 个项目目录并导入重点项目',operator:'系统',result:'已完成'},
  {time:'2026-08-13 10:10',project:'正式标准库',action:'导入已发布团体标准 33 项',operator:'系统',result:'已完成'}
]);
let selectedProject=projects[0];
let selectedStage=selectedProject.current;
let uploadMissingId=null;
let backendEnabled=false;
let currentUser=null;
let archiveProjectId=null;
let liveEventSource=null;
let liveSyncTimer=null;
let lastServerRevision=0;
const isPublicDemo=location.hostname.endsWith('github.io');
const roleLabels={admin:'管理员',operator:'经办人',viewer:'只读人员',expert:'专家'};

async function apiRequest(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body instanceof Blob||options.body instanceof File?{}:{'Content-Type':'application/json'}),...(options.headers||{})}});
  const type=response.headers.get('content-type')||'';
  const payload=type.includes('application/json')?await response.json():null;
  if(!response.ok){const error=new Error(payload?.error||`请求失败（${response.status}）`);error.status=response.status;error.payload=payload;if(response.status===401&&path!=='/api/login')queueMicrotask(()=>showLogin(error.message));throw error}
  return payload;
}

function setConnection(mode,text){
  const state=$('#saveState');state.classList.remove('demo','error','syncing');if(mode)state.classList.add(mode);$('#saveStateText').textContent=text;
}

function canWriteData(){return backendEnabled&&permissions.manageProjects&&!currentUser?.mustChangePassword}

function renderModeBanner(){
  const banner=$('#systemModeBanner'),action=$('#modeBannerAction');
  if(backendEnabled&&currentUser?.mustChangePassword){
    banner.hidden=false;banner.className='system-mode-banner';$('#modeBannerIcon').textContent='!';$('#modeBannerTitle').textContent='首次登录需要启用写入功能';$('#modeBannerText').textContent='请先设置一个新的登录密码，完成后即可上传文件、新建项目和修改数据。';action.textContent='立即设置密码';action.dataset.action='password';return;
  }
  if(!backendEnabled){
    banner.hidden=false;banner.className='system-mode-banner demo';$('#modeBannerIcon').textContent='i';$('#modeBannerTitle').textContent=isPublicDemo?'当前是 GitHub Pages 只读演示版':'尚未连接数据后台';$('#modeBannerText').textContent=isPublicDemo?'此页面不连接数据库，不能真实上传或修改。请使用部署了 Node 后端的系统地址。':'请确认后台服务已启动后重新连接，未连接时页面不会保存修改。';action.textContent=isPublicDemo?'打开本机后台':'重新连接';action.dataset.action=isPublicDemo?'local':'retry';return;
  }
  banner.hidden=true;action.dataset.action='';
}

function applyBootstrap(data,preferredProjectId=selectedProject?.id){
  projects=data.projects;missingItems=data.missingItems;roadmap=data.roadmap;activities=data.activities;standards=data.publishedStandards;documents=data.documents||[];users=data.users||[];backups=data.backups||[];ledgerRecords=data.ledgerRecords||[];annualPlans=data.annualPlans||[];ledgerSummary=data.ledgerSummary||ledgerSummary;analyticsData=data.analytics||analyticsData;permissions=data.permissions||permissions;currentUser=data.user;
  lastServerRevision=Math.max(lastServerRevision,Number(data.revision||0));
  selectedProject=projects.find(project=>project.id===preferredProjectId)||projects[0];selectedStage=selectedProject?.current||1;
  $('#currentUserName').textContent=currentUser?.displayName||'系统管理员';$('#currentUserRole').textContent=roleLabels[currentUser?.role]||'系统用户';$('#logoutButton').hidden=false;
}

async function syncFromBackend(preferredProjectId=selectedProject?.id){
  setConnection('syncing','正在同步');
  const data=await apiRequest('/api/bootstrap');
  backendEnabled=true;applyBootstrap(data,preferredProjectId);setConnection('','数据库已同步');renderModeBanner();
  return data;
}

function stopLiveSync(){
  if(liveEventSource)liveEventSource.close();liveEventSource=null;clearTimeout(liveSyncTimer);
}

function connectLiveSync(){
  stopLiveSync();if(!backendEnabled)return;
  const source=new EventSource('/api/events');liveEventSource=source;
  source.addEventListener('ready',event=>{try{lastServerRevision=Math.max(lastServerRevision,Number(JSON.parse(event.data).revision||0))}catch{}setConnection('','实时同步已连接')});
  source.addEventListener('change',event=>{
    let revision=0;try{revision=Number(JSON.parse(event.data).revision||0)}catch{}
    if(revision&&revision<=lastServerRevision)return;lastServerRevision=Math.max(lastServerRevision,revision);
    clearTimeout(liveSyncTimer);liveSyncTimer=setTimeout(async()=>{try{await syncFromBackend();renderAll();setConnection('','数据已自动同步')}catch(error){if(error.status!==401)setConnection('error','同步暂时中断')}},250);
  });
  source.onerror=()=>{if(backendEnabled)setConnection('error','正在重新连接后台')};
}

function showLogin(message=''){
  setConnection('error','等待登录');$('#loginError').textContent=message;
  if(!$('#loginDialog').open)$('#loginDialog').showModal();
}

function applyPermissions(){
  const accountReady=!currentUser?.mustChangePassword,canWrite=canWriteData();
  $$('[data-new-project]').forEach(button=>button.hidden=!canWrite);
  $('#advanceStage').hidden=!canWrite;$('#addSystemItem').hidden=!canWrite;$('#clearActivities').hidden=!backendEnabled||!permissions.manageUsers||!accountReady;
  $('#backupCard').hidden=!backendEnabled||!permissions.manageBackups||!accountReady;$('#userManagement').hidden=!backendEnabled||!permissions.manageUsers||!accountReady;
}

function renderAll(){buildFilters();renderDashboard();renderAnalytics();renderProjectTable();renderLedger();renderMissing();renderSystem();renderActivities();renderSettings();applyPermissions();renderModeBanner()}

async function initialize(){
  renderAll();
  setConnection('syncing','正在连接数据');
  try{await syncFromBackend();renderAll();connectLiveSync();if(currentUser?.mustChangePassword){navigate('settings');showToast('请先修改初始密码','账号安全')}}
  catch(error){
    if(error.status===401){showLogin();return}
    backendEnabled=false;setConnection('demo','只读演示 · 未连接后台');renderModeBanner();
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
  if(backendEnabled&&currentUser?.mustChangePassword&&page!=='settings'){page='settings';showToast('设置新密码后即可上传和修改数据','请先启用账号')}
  $$('.page').forEach(view=>view.classList.toggle('active',view.dataset.pageView===page));
  $$('.nav-item[data-page]').forEach(item=>item.classList.toggle('active',item.dataset.page===page));
  $('#breadcrumb').textContent=$(`.nav-item[data-page="${page}"] span:last-of-type`)?.textContent||'工作台';
  $('#sidebar').classList.remove('open');
  if(page==='dashboard')renderDashboard();
  if(page==='analytics')renderAnalytics();
  if(page==='projects')renderProjectTable();
  if(page==='ledger')renderLedger();
  if(page==='workflow')renderWorkflow();
  if(page==='missing')renderMissing();
  if(page==='system')renderSystem();
  if(page==='settings')renderSettings();
  window.scrollTo({top:0,behavior:'smooth'});
}

function updateCounts(){
  const open=missingItems.filter(item=>item.state==='open').length;
  $('#missingCount').textContent=open; $('#missingNavCount').textContent=open; $('#projectNavCount').textContent=projects.length;
  $('#ledgerNavCount').textContent=ledgerSummary.records||ledgerRecords.length||0;
  $('#activeProjectCount').textContent=projects.filter(project=>project.status==='在研'&&!project.archived).length;
}

function renderDashboard(){
  updateCounts();
  const focus=[...projects].filter(p=>p.status==='在研'&&!p.archived).sort((a,b)=>(b.current-a.current)||(projectMissing(b.id).length-projectMissing(a.id).length)).slice(0,6);
  $('#dashboardProjects').innerHTML=focus.map((project,index)=>`<button class="dashboard-project" data-focus="${project.id}"><span class="index">${String(index+1).padStart(2,'0')}</span><span class="project-main"><strong>${h(project.name)}</strong><small>${h(stages[project.current-1].name)} · ${h(project.owner)}</small><i><b style="width:${progressFor(project)}%"></b></i></span><span class="project-side"><strong>${progressFor(project)}%</strong><small class="${projectMissing(project.id).length?'warn':''}">${projectMissing(project.id).length?`${projectMissing(project.id).length} 项待确认`:'材料正常'}</small></span></button>`).join('');
  $$('[data-focus]').forEach(button=>button.addEventListener('click',()=>openWorkflow(Number(button.dataset.focus))));
  const topMissing=missingItems.filter(item=>item.state==='open').slice(0,5);
  $('#taskCount').textContent=topMissing.length;
  $('#taskList').innerHTML=topMissing.map(item=>{const project=projects.find(p=>p.id===item.projectId);return `<button class="task-line" data-missing-link="${item.id}"><span>!</span><div><strong>${h(item.material)}</strong><small>${h(project?.name||'未知项目')} · ${h(item.category)}</small></div><em>待确认</em></button>`}).join('')||'<div class="empty-state">暂无待处理材料</div>';
  $$('[data-missing-link]').forEach(button=>button.addEventListener('click',()=>navigate('missing')));
  $('#compactFlow').innerHTML=`<div class="compact-flow-line">${stages.map((stage,index)=>`${index?'<b></b>':''}<div class="compact-step ${index<7?'done':index===7?'active':''}"><i>${index<7?'✓':index+1}</i><strong>${stage.short}</strong></div>`).join('')}</div>`;
}

function renderAnalytics(){
  const activeProjects=projects.filter(project=>!project.archived);
  const openMissing=missingItems.filter(item=>item.state==='open');
  const linked=ledgerSummary.linked||ledgerRecords.filter(item=>item.linkedProjectId).length;
  const kpis=[
    ['项目台账',projects.length,'全部项目','cyan'],
    ['历史 Excel',ledgerSummary.records||ledgerRecords.length,'原表记录','blue'],
    ['已发布标准',standards.length,'正式标准库','green'],
    ['待补材料',openMissing.length,'需及时处理','orange']
  ];
  $('#analyticsKpis').innerHTML=kpis.map(([label,value,note,tone])=>`<div class="analytics-kpi ${tone}"><small>${h(label)}</small><strong>${value}</strong><span>${h(note)}</span></div>`).join('');
  $('#analyticsTimestamp').textContent=`实时数据 · ${new Date().toLocaleString('zh-CN',{hour12:false})}`;

  let yearData=analyticsData.standardsByYear||[];
  if(!yearData.length){const map=new Map();standards.forEach(([code])=>{const year=Number(String(code).match(/(20\d{2})$/)?.[1]);if(year)map.set(year,(map.get(year)||0)+1)});yearData=[...map].map(([year,total])=>({year,total})).sort((a,b)=>a.year-b.year)}
  const width=620,height=230,pad={left:42,right:20,top:22,bottom:38},maxTotal=Math.max(1,...yearData.map(item=>item.total));
  const points=yearData.map((item,index)=>({x:pad.left+(yearData.length===1?0:(width-pad.left-pad.right)*index/(yearData.length-1)),y:height-pad.bottom-(height-pad.top-pad.bottom)*item.total/maxTotal,...item}));
  const grid=[0,.25,.5,.75,1].map(ratio=>{const y=height-pad.bottom-(height-pad.top-pad.bottom)*ratio;return `<line x1="${pad.left}" y1="${y}" x2="${width-pad.right}" y2="${y}"/><text x="${pad.left-10}" y="${y+4}" text-anchor="end">${Math.round(maxTotal*ratio)}</text>`}).join('');
  const line=points.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(' ');
  $('#publishedTrendChart').innerHTML=yearData.length?`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="年度发布标准数量趋势"><g class="chart-grid">${grid}</g><path class="chart-area" d="${line} L${points.at(-1).x},${height-pad.bottom} L${points[0].x},${height-pad.bottom} Z"/><path class="chart-line" d="${line}"/>${points.map(point=>`<g><circle cx="${point.x}" cy="${point.y}" r="5"/><text x="${point.x}" y="${height-12}" text-anchor="middle">${point.year}</text><text class="point-label" x="${point.x}" y="${point.y-12}" text-anchor="middle">${point.total}</text></g>`).join('')}</svg>`:'<div class="analytics-empty">暂无年度数据</div>';

  const statusBuckets=[
    {label:'在研',color:'#29d9ef',count:activeProjects.filter(item=>item.status==='在研').length},
    {label:'已发布',color:'#45e29b',count:activeProjects.filter(item=>item.status==='已发布').length},
    {label:'待核实/暂停',color:'#ffc45c',count:activeProjects.filter(item=>['待核实','暂停'].includes(item.status)).length},
    {label:'已归档',color:'#7798bd',count:projects.filter(item=>item.archived).length}
  ];
  const statusTotal=Math.max(1,statusBuckets.reduce((sum,item)=>sum+item.count,0));let start=0;
  const gradient=statusBuckets.map(item=>{const from=start;start+=item.count/statusTotal*360;return `${item.color} ${from}deg ${start}deg`}).join(',');
  $('#statusDonut').innerHTML=`<div class="donut-wrap"><div class="donut-chart" style="background:conic-gradient(${gradient||'#183b55 0deg 360deg'})"><div><strong>${projects.length}</strong><span>项目</span></div></div><div class="donut-legend">${statusBuckets.map(item=>`<span><i style="background:${item.color}"></i><b>${h(item.label)}</b><em>${item.count}</em></span>`).join('')}</div></div>`;

  const stageCounts=stages.map((stage,index)=>({stage,index:index+1,count:activeProjects.filter(project=>project.current===index+1).length}));
  const maxStage=Math.max(1,...stageCounts.map(item=>item.count));
  $('#stageDistribution').innerHTML=stageCounts.filter(item=>item.count).sort((a,b)=>b.count-a.count).slice(0,8).map(item=>`<div class="stage-bar"><span>${String(item.index).padStart(2,'0')} ${h(item.stage.short)}</span><i><b style="width:${Math.max(5,item.count/maxStage*100)}%"></b></i><em>${item.count}</em></div>`).join('')||'<div class="analytics-empty">暂无项目阶段数据</div>';

  const completeProjects=activeProjects.filter(project=>!projectMissing(project.id).length).length;
  const completeness=activeProjects.length?Math.round(completeProjects/activeProjects.length*100):100;
  const resolved=missingItems.filter(item=>item.state==='resolved').length;
  $('#qualityMetrics').innerHTML=`<div class="quality-score"><strong>${completeness}<small>%</small></strong><span>项目材料完整率</span><i><b style="width:${completeness}%"></b></i></div><div class="quality-list"><span><i>✓</i><b>${completeProjects}</b><em>材料完整项目</em></span><span><i>!</i><b>${openMissing.length}</b><em>待补材料</em></span><span><i>↗</i><b>${resolved}</b><em>已补充材料</em></span><span><i>链</i><b>${linked}</b><em>Excel 已关联</em></span></div>`;

  $('#planTotal').textContent=`${annualPlans.length||ledgerSummary.plans||0} 项`;
  $('#annualPlanPreview').innerHTML=annualPlans.slice(0,7).map((item,index)=>`<div><i>${String(index+1).padStart(2,'0')}</i><span>${h(item.name)}</span></div>`).join('')||'<div class="analytics-empty">本地后台登录后显示年度计划</div>';
  const heatMax=Math.max(1,...stageCounts.map(item=>item.count));
  $('#processHeatmap').innerHTML=`<div class="heatmap-line">${stageCounts.map(item=>{const intensity=.16+.84*item.count/heatMax;return `<div style="--heat:${intensity}"><i>${String(item.index).padStart(2,'0')}</i><strong>${h(item.stage.short)}</strong><span>${item.count} 项</span></div>`}).join('')}</div>`;
}

function buildFilters(){
  const names=[...new Set(stages.map(s=>s.name))];
  $('#statusFilter').innerHTML='<option value="all">全部环节</option>'+names.map(n=>`<option>${n}</option>`).join('');
  $('#missingStageFilter').innerHTML='<option value="all">全部环节</option>'+[...new Set(missingItems.map(i=>i.category))].map(n=>`<option>${n}</option>`).join('');
  $('#editStageSelect').innerHTML=stages.map((s,i)=>`<option value="${i+1}">${i+1}. ${s.name}</option>`).join('');
  $('#archiveStageSelect').innerHTML=stages.map((s,i)=>`<option value="${i+1}">${i+1}. ${h(s.name)}</option>`).join('');
  $('#archiveCategorySelect').innerHTML='<option value="">自动识别</option>'+documentCategories.map(category=>`<option>${h(category)}</option>`).join('');
  const archiveFilterStage=$('#archiveStageFilter').value||'all',archiveFilterCategory=$('#archiveCategoryFilter').value||'all';
  $('#archiveStageFilter').innerHTML='<option value="all">全部流程节点</option>'+stages.slice(0,15).map((s,i)=>`<option value="${i+1}">${i+1}. ${h(s.short)}</option>`).join('');
  $('#archiveCategoryFilter').innerHTML='<option value="all">全部材料分类</option>'+documentCategories.map(category=>`<option>${h(category)}</option>`).join('');
  $('#archiveStageFilter').value=[...$('#archiveStageFilter').options].some(option=>option.value===archiveFilterStage)?archiveFilterStage:'all';
  $('#archiveCategoryFilter').value=[...$('#archiveCategoryFilter').options].some(option=>option.value===archiveFilterCategory)?archiveFilterCategory:'all';
  $('#ledgerStageSelect').innerHTML=stages.map((s,i)=>`<option value="${i+1}">${i+1}. ${h(s.name)}</option>`).join('');
  const ledgerStageValue=$('#ledgerStageFilter').value||'all';
  $('#ledgerStageFilter').innerHTML='<option value="all">全部环节</option>'+stages.map((s,i)=>`<option value="${i+1}">${i+1}. ${h(s.short)}</option>`).join('');
  $('#ledgerStageFilter').value=[...$('#ledgerStageFilter').options].some(option=>option.value===ledgerStageValue)?ledgerStageValue:'all';
}

function renderProjectTable(){
  updateCounts();
  const query=$('#projectSearch').value.trim().toLowerCase(),status=$('#statusFilter').value,archive=$('#archiveFilter').value,canWrite=canWriteData();
  const filtered=projects.filter(p=>(archive==='all'||(archive==='archived'&&p.archived)||(archive==='active'&&!p.archived))&&(status==='all'||stages[p.current-1].name===status)&&`${p.name}${p.code}${p.owner}`.toLowerCase().includes(query));
  $('#projectRows').innerHTML=filtered.map(project=>`<div class="table-row ${project.archived?'archived-project':''}"><span class="project-name"><i>标</i><span><strong>${h(project.name)}</strong><small>${h(project.code||'暂未编号')} · ${project.files||0} 个目录文件 ${project.archived?'· 已归档':''}</small></span></span><span>${project.archived?'<i class="archived-badge">已归档</i>':`<i class="project-status">${h(stages[project.current-1].name)}</i>`}</span><span>${h(project.owner||'待补充')}</span><span><b class="material-count ${projectMissing(project.id).length?'has-missing':''}">${projectMissing(project.id).length?`${projectMissing(project.id).length} 待确认`:'完整'}</b></span><span>${progressFor(project)}%</span><span class="row-actions"><button data-open="${project.id}">${canWrite&&!project.archived?'办理':'查看'}</button><button data-archive-files="${project.id}">档案</button>${canWrite?`<button data-edit="${project.id}">修改</button><button data-toggle-archive="${project.id}">${project.archived?'恢复':'归档'}</button>`:''}</span></div>`).join('')||'<div class="empty-state">没有找到符合条件的项目</div>';
  $$('[data-open]').forEach(button=>button.addEventListener('click',()=>openWorkflow(Number(button.dataset.open))));
  $$('[data-edit]').forEach(button=>button.addEventListener('click',()=>openEdit(Number(button.dataset.edit))));
  $$('[data-archive-files]').forEach(button=>button.addEventListener('click',()=>openArchive(Number(button.dataset.archiveFiles))));
  $$('[data-toggle-archive]').forEach(button=>button.addEventListener('click',()=>toggleArchive(Number(button.dataset.toggleArchive))));
}

function ledgerFee(record){
  if(record.totalFee)return record.totalFee;
  const values=[record.establishmentFee,record.reviewFee,record.publicationFee].map(value=>Number(value)).filter(Number.isFinite);
  return values.length?String(values.reduce((sum,value)=>sum+value,0)):'';
}

function renderLedger(){
  updateCounts();
  const summary=[
    ['原表项目',ledgerSummary.records||ledgerRecords.length,'条'],
    ['发布记录',ledgerSummary.published||0,'条'],
    ['2025 计划',ledgerSummary.plans||annualPlans.length,'项'],
    ['已关联项目',ledgerSummary.linked||ledgerRecords.filter(item=>item.linkedProjectId).length,'项']
  ];
  $('#ledgerSummaryCards').innerHTML=summary.map(([label,value,unit])=>`<div><span>${h(label)}</span><strong>${value}<small>${unit}</small></strong></div>`).join('');
  $('#ledgerSourceName').textContent=ledgerSummary.sourceName||'科技发展部工作信息 - 团体标准.xlsx';
  const sourceDate=ledgerSummary.sourceModifiedAt?new Date(ledgerSummary.sourceModifiedAt).toLocaleString('zh-CN',{hour12:false}):'';
  const importDate=ledgerSummary.importedAt?new Date(ledgerSummary.importedAt).toLocaleString('zh-CN',{hour12:false}):'';
  $('#ledgerSourceMeta').textContent=ledgerSummary.records?`原文件更新：${sourceDate} · 数据导入：${importDate}`:'本地后台尚未载入历史 Excel 数据';
  $('#ledgerPlanChips').innerHTML=annualPlans.slice(0,4).map(item=>`<span>${h(item.name)}</span>`).join('')+(annualPlans.length>4?`<em>另 ${annualPlans.length-4} 项</em>`:'');

  const query=$('#ledgerSearch').value.trim().toLowerCase(),stage=$('#ledgerStageFilter').value,status=$('#ledgerStatusFilter').value;
  const canManage=backendEnabled&&permissions.manageLedger&&!currentUser?.mustChangePassword;
  const filtered=ledgerRecords.filter(record=>(stage==='all'||record.currentStage===Number(stage))&&(status==='all'||record.status===status)&&`${record.projectName}${record.planCode}${record.standardCode}${record.commissioningUnit}${record.contact}`.toLowerCase().includes(query));
  $('#ledgerRows').innerHTML=filtered.map(record=>`<div class="table-row"><span class="project-name"><i>史</i><span><strong>${h(record.projectName)}</strong><small>${h(record.standardCode||record.planCode||'暂未编号')} · 原表第 ${record.sourceRow} 行</small></span></span><span><i class="project-status">${h(stages[record.currentStage-1]?.name||'待核实')}</i><small class="ledger-status">${h(record.status)}</small></span><span><strong class="ledger-unit">${h(record.commissioningUnit||'待补充')}</strong><small>${h(record.contact||(!canManage&&backendEnabled?'敏感信息已隐藏':'未登记'))}</small></span><span>${ledgerFee(record)?`<b>${h(ledgerFee(record))}</b> 万`:'—'}</span><span>${record.linkedProjectId?'<i class="linked-badge">已关联</i>':'<i class="unlinked-badge">未关联</i>'}</span><span class="row-actions"><button data-ledger-open="${record.id}">${canManage?'查看 / 修改':'查看'}</button>${canManage&&!record.linkedProjectId?`<button data-ledger-promote="${record.id}">转入项目</button>`:''}${record.linkedProjectId?`<button data-ledger-project="${record.linkedProjectId}">打开项目</button>`:''}</span></div>`).join('')||`<div class="empty-state">${ledgerSummary.records&&!ledgerRecords.length?'请先修改初始密码后查看历史台账':'没有找到符合条件的历史记录'}</div>`;
  $$('[data-ledger-open]').forEach(button=>button.addEventListener('click',()=>openLedger(Number(button.dataset.ledgerOpen))));
  $$('[data-ledger-promote]').forEach(button=>button.addEventListener('click',()=>promoteLedger(Number(button.dataset.ledgerPromote))));
  $$('[data-ledger-project]').forEach(button=>button.addEventListener('click',()=>openWorkflow(Number(button.dataset.ledgerProject))));
}

function openLedger(id){
  const record=ledgerRecords.find(item=>item.id===id);if(!record)return;
  const form=$('#ledgerForm'),canManage=backendEnabled&&permissions.manageLedger&&!currentUser?.mustChangePassword;
  ['id','projectName','planCode','standardCode','currentStage','status','commissioningUnit','contact','establishmentFee','reviewFee','publicationFee','totalFee','expertFee','contractInfo','remarks'].forEach(name=>{if(form.elements[name])form.elements[name].value=record[name]??''});
  $('#ledgerDialogTitle').textContent=record.projectName;$('#ledgerDialogSource').textContent=`${record.sourceSheet} · 第 ${record.sourceRow} 行`;
  $('#ledgerProgressDetail').innerHTML=(record.progress||[]).map(item=>`<div><span>${h(item.label)}</span><strong>${h(item.value)}</strong></div>`).join('')||'<div class="empty-state compact">原表未登记阶段材料</div>';
  $$('input,select,textarea',form).forEach(field=>field.disabled=!canManage&&field.name!=='id');
  $('#saveLedgerRecord').hidden=!canManage;
  $('#ledgerDialog').showModal();
}

async function promoteLedger(id){
  const button=$(`[data-ledger-promote="${id}"]`);button?.classList.add('button-busy');
  try{const result=await apiRequest(`/api/ledger/${id}/promote`,{method:'POST',body:'{}'});await syncFromBackend(result.project.id);renderAll();showToast('历史记录已关联到项目台账')}
  catch(error){showToast(error.message,'关联失败')}finally{button?.classList.remove('button-busy')}
}

function openWorkflow(id){selectedProject=projects.find(p=>p.id===id)||projects[0];selectedStage=selectedProject.current;navigate('workflow')}

function renderProjectMenu(){
  $('#projectMenu').innerHTML=projects.filter(p=>!p.archived).map(p=>`<button data-project-id="${p.id}"><strong>${h(p.name)}</strong><small>${h(stages[p.current-1].name)} · ${h(p.code||'暂未编号')}</small></button>`).join('');
  $$('#projectMenu button').forEach(button=>button.addEventListener('click',()=>{selectedProject=projects.find(p=>p.id===Number(button.dataset.projectId));selectedStage=selectedProject.current;$('#projectMenu').classList.remove('open');renderWorkflow()}));
}

function renderWorkflow(){
  if(!selectedProject)selectedProject=projects[0];
  const progress=progressFor(selectedProject);
  $('#selectedProjectName').textContent=selectedProject.name; $('#selectedProjectCode').textContent=selectedProject.code||'暂未编号';
  $('#currentStageText').textContent=stages[selectedProject.current-1].name; $('#dueDateText').textContent=selectedProject.due||'待确定';
  $('#ownerText').textContent=selectedProject.owner||'待补充'; $('#progressText').textContent=`${progress}%`; $('#progressBar').style.width=`${progress}%`;
  $('#advanceStage').disabled=selectedProject.current>=stages.length||selectedProject.status==='已发布'||selectedProject.archived;
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
  const canWrite=canWriteData();
  const missingAtStage=missingItems.filter(i=>i.projectId===selectedProject.id&&i.stage===selectedStage&&i.state==='open');
  const stageDocuments=documents.filter(item=>item.projectId===selectedProject.id&&item.stage===selectedStage);
  const originalNotes=selectedProject.notes;selectedProject.notes=h(originalNotes||'暂无备注');
  $('#stageDetail').innerHTML=`<div class="detail-cover"><div class="detail-topline"><span class="step-label">STEP ${String(selectedStage).padStart(2,'0')} / 15</span><span class="stage-badge">${isDone?'已完成':isActive?'办理中':'待开始'}</span></div><h2>${stage.name}</h2><p>${stage.owner} · ${stage.duration}</p></div><div class="detail-body"><section class="detail-section"><h3>所需材料</h3>${stage.materials.map(material=>{const isMissing=missingAtStage.some(i=>material.includes(i.material)||i.material.includes(material));return `<div class="material-item ${isMissing?'missing-material':''}"><span class="material-icon">${isMissing?'!':'W'}</span><div><strong>${material}</strong><small>${isMissing?'目录中未识别到，需确认':isDone?'已完成环节材料':'按节点准备'}</small></div>${isMissing?'<button data-jump-missing>补充</button>':'<button data-preview>查看</button>'}</div>`}).join('')}</section><section class="detail-section"><h3>办理要求</h3><ul class="requirement-list">${stage.requirements.map(r=>`<li>${r}</li>`).join('')}</ul>${stage.branch?`<div class="branch-note"><strong>退回路径</strong>${stage.branch}</div>`:''}</section><section class="detail-section"><h3>项目备注</h3><p class="project-note">${selectedProject.notes||'暂无备注'}</p></section><div class="detail-actions">${stage.review&&isActive?'<button class="danger-button" id="returnStage">退回修改</button>':''}<button class="primary" id="detailAction">${isActive?'办理当前环节':'查看记录'}</button></div></div>`;
  selectedProject.notes=originalNotes;
  if(!canWrite){$('#returnStage')?.remove();$('#detailAction').textContent='查看记录'}
  if(stageDocuments.length){const section=document.createElement('section');section.className='detail-section';section.innerHTML=`<h3>已归档文件</h3><div class="file-list">${stageDocuments.map(file=>`<a class="file-link" href="${h(file.downloadUrl)}"><span>▤ ${h(file.name)}</span><small>${h(file.category||'其他材料')} · ${h(file.createdAt)}</small></a>`).join('')}</div>`;$('.detail-actions',$('#stageDetail')).before(section)}
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
  updateCounts(); const q=$('#missingSearch').value.trim().toLowerCase(),stage=$('#missingStageFilter').value,state=$('#missingStateFilter').value,canWrite=canWriteData();
  const filtered=missingItems.filter(item=>(state==='all'||item.state===state)&&(stage==='all'||item.category===stage)&&`${item.material}${projects.find(p=>p.id===item.projectId)?.name||''}`.toLowerCase().includes(q));
  $('#missingList').innerHTML=filtered.map(item=>{const project=projects.find(p=>p.id===item.projectId),writeActions=canWrite?(item.state==='open'?`<button class="primary" data-upload="${item.id}">补充文件</button><button class="secondary" data-ignore="${item.id}">忽略误报</button>`:`<button class="secondary" data-reopen="${item.id}">重新打开</button>`):'';return `<div class="missing-item ${item.state!=='open'?'closed':''}"><span class="missing-icon">${item.state==='open'?'!':item.state==='resolved'?'✓':'—'}</span><div class="missing-main"><div><strong>${h(item.material)}</strong><i class="project-status">${h(item.category)}</i></div><p>${h(project?.name||'未知项目')}</p><small>${h(item.filename||item.source)} · ${item.state==='open'?'待人工确认':item.state==='resolved'?'已补充':'已忽略误报'}</small></div><div class="missing-actions">${writeActions}<button class="text-button" data-project="${item.projectId}">查看项目</button></div></div>`}).join('')||'<div class="empty-state">没有符合条件的待补材料</div>';
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

function formatBytes(value){
  const bytes=Number(value||0);if(bytes<1024)return `${bytes} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1024/1024).toFixed(1)} MB`;
}

function renderArchiveFiles(){
  const project=projects.find(item=>item.id===archiveProjectId);if(!project)return;
  const query=$('#archiveFileSearch').value.trim().toLowerCase(),stageFilter=$('#archiveStageFilter').value,categoryFilter=$('#archiveCategoryFilter').value;
  const allFiles=documents.filter(item=>item.projectId===project.id);
  const files=allFiles.filter(file=>(stageFilter==='all'||String(file.stage)===stageFilter)&&(categoryFilter==='all'||file.category===categoryFilter)&&`${file.name}${file.category||''}${file.sourcePath||''}`.toLowerCase().includes(query)).sort((a,b)=>a.stage-b.stage||(a.category||'').localeCompare(b.category||'','zh-CN')||b.id-a.id);
  $('#archiveProjectName').textContent=project.name;$('#archiveStageSelect').value=String(project.current);
  $('#archiveUploadForm').hidden=!canWriteData();
  $('#archiveFileSummary').textContent=`显示 ${files.length} / ${allFiles.length} 个文件`;
  const groups=[];
  for(const file of files){const key=`${file.stage}|${file.category||'其他材料'}`;let group=groups.find(item=>item.key===key);if(!group){group={key,stage:file.stage,category:file.category||'其他材料',files:[]};groups.push(group)}group.files.push(file)}
  $('#archiveFileList').innerHTML=groups.map(group=>`<section class="archive-file-group"><div class="archive-group-title"><div><span>${String(group.stage).padStart(2,'0')}</span><strong>${h(stages[group.stage-1]?.name||'项目档案')}</strong><em>${h(group.category)}</em></div><small>${group.files.length} 个文件</small></div>${group.files.map(file=>`<div class="archive-file-item"><span>▤</span><div><strong>${h(file.name)}</strong><small>${formatBytes(file.size)} · ${h(file.createdAt)}</small>${file.sourcePath?`<small class="archive-source-path">原目录：${h(file.sourcePath)}</small>`:''}</div><div class="archive-file-controls">${canWriteData()?`<select data-document-category="${file.id}" aria-label="调整文件分类">${documentCategories.map(category=>`<option ${category===(file.category||'其他材料')?'selected':''}>${h(category)}</option>`).join('')}</select>`:`<i>${h(file.category||'其他材料')}</i>`}<div class="archive-file-actions">${file.previewUrl?`<a href="${h(file.previewUrl)}" target="_blank" rel="noopener">预览</a>`:''}<a href="${h(file.downloadUrl)}">下载</a></div></div></div>`).join('')}</section>`).join('')||'<div class="empty-state">没有符合条件的归档文件</div>';
  $$('[data-document-category]',$('#archiveFileList')).forEach(select=>select.addEventListener('change',()=>updateDocumentCategory(Number(select.dataset.documentCategory),select.value)));
}

function openArchive(id){
  archiveProjectId=id;$('#archiveUploadForm').reset();$('#archiveFileSearch').value='';$('#archiveStageFilter').value='all';$('#archiveCategoryFilter').value='all';renderArchiveFiles();$('#archiveDialog').showModal();
}

async function updateDocumentCategory(id,category){
  try{await apiRequest(`/api/documents/${id}`,{method:'PATCH',body:JSON.stringify({category})});await syncFromBackend(archiveProjectId);renderArchiveFiles();showToast(`已归入“${category}”`,'分类已更新')}
  catch(error){renderArchiveFiles();showToast(error.message,'分类失败')}
}

async function toggleArchive(id){
  const project=projects.find(item=>item.id===id);if(!project)return;
  try{if(backendEnabled){await apiRequest(`/api/projects/${id}/archive`,{method:'POST',body:JSON.stringify({archived:!project.archived})});await syncFromBackend(id)}else{project.archived=!project.archived;save('cadp-projects-v3',projects)}renderProjectTable();renderDashboard();showToast(project.archived?'项目已安全归档':'项目已恢复')}
  catch(error){showToast(error.message,'归档失败')}
}

function renderSettings(){
  $('#passwordNotice').hidden=!currentUser?.mustChangePassword;
  const latest=backups[0];
  $('#backupSummary').innerHTML=latest?`<strong>${backups.length} 份备份</strong>最近备份：${h(latest.createdAt)} · ${formatBytes(latest.totalBytes)}`:'<strong>尚无备份</strong>系统启动后会自动创建每日备份';
  $('#backupList').innerHTML=backups.slice(0,8).map(item=>`<div class="backup-item"><span>备</span><div><strong>${h(item.reason)}</strong><small>${h(item.createdAt)} · ${item.fileCount||0} 个文件 · ${formatBytes(item.totalBytes)}</small></div><a href="${h(item.databaseUrl)}">下载数据库</a></div>`).join('')||'<div class="empty-state">暂无备份记录</div>';
  $('#userRows').innerHTML=users.map(item=>`<div class="table-row"><span class="user-identity"><strong>${h(item.displayName)}</strong><small>${item.passwordChanged?'密码已设置':'首次登录待改密'}</small></span><span>${h(item.username)}</span><span><select class="role-select" data-user-role="${item.id}" ${item.id===currentUser?.id?'disabled':''}>${Object.entries(roleLabels).map(([value,label])=>`<option value="${value}" ${item.role===value?'selected':''}>${label}</option>`).join('')}</select></span><span>${h(item.lastLoginAt||'尚未登录')}</span><span><button class="user-status-button ${item.active?'':'off'}" data-user-active="${item.id}" ${item.id===currentUser?.id?'disabled':''}>${item.active?'已启用':'已停用'}</button></span></div>`).join('')||'<div class="empty-state">暂无用户</div>';
  $$('[data-user-role]').forEach(select=>select.addEventListener('change',()=>updateUser(Number(select.dataset.userRole),{role:select.value})));
  $$('[data-user-active]').forEach(button=>button.addEventListener('click',()=>{const item=users.find(user=>user.id===Number(button.dataset.userActive));updateUser(item.id,{active:!item.active})}));
}

async function updateUser(id,changes){
  try{await apiRequest(`/api/users/${id}`,{method:'PATCH',body:JSON.stringify(changes)});await syncFromBackend();renderSettings();showToast('用户权限已更新')}
  catch(error){renderSettings();showToast(error.message,'更新失败')}
}

function categoryFor(name){if(/航空|直升机|无人机/.test(name))return'航空与低空救援';if(/地震|滑坡|地质|泥石流|矿山/.test(name))return'地震地质灾害';if(/洪|旱|气象/.test(name))return'洪涝气象灾害';if(/建筑|房屋|燃气/.test(name))return'建筑与城市安全';if(/应急|救援|物资|食品|装备|机器人/.test(name))return'应急救援与保障';return'综合防灾减灾'}

function renderSystem(){
  const canWrite=canWriteData();
  $('#systemLayers').innerHTML=systemLayers.map(layer=>`<div class="system-layer"><span>${layer[0]}</span><div><strong>${layer[1]}</strong><p>${layer[2]}</p><small>${layer[3]}</small></div></div>`).join('');
  $('#roadmapCount').textContent=`${roadmap.filter(r=>!r.done).length} 项待办`;
  $('#roadmapList').innerHTML=roadmap.map(item=>`<label class="roadmap-item"><input type="checkbox" data-roadmap="${item.id}" ${item.done?'checked':''} ${canWrite?'':'disabled'}><span></span><div><strong>${h(item.title)}</strong><small>${h(item.owner)} · 计划 ${h(item.due)}</small></div></label>`).join('');
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
$('#projectSearch').addEventListener('input',renderProjectTable); $('#statusFilter').addEventListener('change',renderProjectTable);$('#archiveFilter').addEventListener('change',renderProjectTable);
$('#ledgerSearch').addEventListener('input',renderLedger);$('#ledgerStageFilter').addEventListener('change',renderLedger);$('#ledgerStatusFilter').addEventListener('change',renderLedger);
$('#missingSearch').addEventListener('input',renderMissing); $('#missingStageFilter').addEventListener('change',renderMissing); $('#missingStateFilter').addEventListener('change',renderMissing);
$('#archiveFileSearch').addEventListener('input',renderArchiveFiles);$('#archiveStageFilter').addEventListener('change',renderArchiveFiles);$('#archiveCategoryFilter').addEventListener('change',renderArchiveFiles);
$('#standardSearch').addEventListener('input',renderStandardRows);
$$('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>$('#projectDialog').close())); $$('[data-close-edit]').forEach(b=>b.addEventListener('click',()=>$('#editDialog').close())); $$('[data-close-upload]').forEach(b=>b.addEventListener('click',()=>$('#uploadDialog').close()));$$('[data-close-archive]').forEach(b=>b.addEventListener('click',()=>$('#archiveDialog').close()));$$('[data-close-user]').forEach(b=>b.addEventListener('click',()=>$('#userDialog').close()));$$('[data-close-ledger]').forEach(b=>b.addEventListener('click',()=>$('#ledgerDialog').close()));
$('#refreshAnalytics').addEventListener('click',async()=>{const button=$('#refreshAnalytics');button.classList.add('button-busy');try{if(backendEnabled)await syncFromBackend();renderAnalytics();showToast('数据看板已刷新')}catch(error){showToast(error.message,'刷新失败')}finally{button.classList.remove('button-busy')}});
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
  if(selectedProject.current>=stages.length)return;const blockers=missingItems.filter(item=>item.projectId===selectedProject.id&&item.stage===selectedProject.current&&item.state==='open');if(blockers.length){navigate('missing');showToast(`当前环节还有 ${blockers.length} 项材料待处理`,'材料未齐');return}const projectId=selectedProject.id,before=stages[selectedProject.current-1].name;$('#advanceStage').classList.add('button-busy');
  try{
    if(backendEnabled){await apiRequest(`/api/projects/${projectId}/advance`,{method:'POST',body:'{}'});await syncFromBackend(projectId)}
    else{selectedProject.current+=1;selectedStage=selectedProject.current;if(selectedProject.current===stages.length)selectedProject.status='已发布';save('cadp-projects-v3',projects);addActivity(selectedProject.name,`完成“${before}”，进入“${stages[selectedProject.current-1].name}”`)}
    renderWorkflow();renderDashboard();showToast('已推进到下一环节');
  }catch(error){if(error.payload?.code==='MATERIALS_INCOMPLETE')navigate('missing');showToast(error.message,error.payload?.code==='MATERIALS_INCOMPLETE'?'材料未齐':'流程推进失败')}finally{$('#advanceStage').classList.remove('button-busy')}
});
$('#ledgerForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!backendEnabled||!permissions.manageLedger)return;const d=Object.fromEntries(new FormData(event.target)),id=Number(d.id),button=$('#saveLedgerRecord');button.classList.add('button-busy');
  try{await apiRequest(`/api/ledger/${id}`,{method:'PUT',body:JSON.stringify(d)});await syncFromBackend();$('#ledgerDialog').close();renderLedger();renderAnalytics();showToast('历史台账记录已保存')}
  catch(error){showToast(error.message,'保存失败')}finally{button.classList.remove('button-busy')}
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
$('#exportProjects').addEventListener('click',()=>downloadCsv('团体标准项目台账.csv',[['标准名称','项目编号','牵头单位','当前环节','状态','归档状态','计划完成','待补材料数'],...projects.map(p=>[p.name,p.code,p.owner,stages[p.current-1].name,p.status,p.archived?'已归档':'在用',p.due,projectMissing(p.id).length])]));
$('#exportMissing').addEventListener('click',()=>downloadCsv('团体标准待补材料清单.csv',[['项目名称','当前环节','待补材料','类别','处理状态','判断依据'],...missingItems.map(i=>[projects.find(p=>p.id===i.projectId)?.name,stages[i.stage-1]?.name,i.material,i.category,i.state,i.source])]));
$('#exportLedger').addEventListener('click',()=>downloadCsv('科技发展部团体标准历史台账.csv',[['标准名称','计划编号','标准编号','当前环节','状态','委托方','联系人','立项论证费（万）','征求意见及审查费（万）','出版费（万）','总额（万）','专家劳务费','合同信息','备注','原表行'],...ledgerRecords.map(item=>[item.projectName,item.planCode,item.standardCode,stages[item.currentStage-1]?.name,item.status,item.commissioningUnit,item.contact,item.establishmentFee,item.reviewFee,item.publicationFee,item.totalFee,item.expertFee,item.contractInfo,item.remarks,item.sourceRow])]));
$('#addSystemItem').addEventListener('click',async()=>{const title=prompt('请输入体系建设任务：');if(!title)return;try{if(backendEnabled){await apiRequest('/api/roadmap',{method:'POST',body:JSON.stringify({title})});await syncFromBackend()}else{roadmap.push({id:Date.now(),title,owner:'待指定',due:'待确定',done:false});save('cadp-roadmap-v2',roadmap)}renderSystem();showToast('体系任务已添加')}catch(error){showToast(error.message,'添加失败')}});
$('#globalSearchButton').addEventListener('click',()=>{navigate('projects');$('#projectSearch').focus()});
$('#modeBannerAction').addEventListener('click',async event=>{
  const action=event.currentTarget.dataset.action;
  if(action==='password'){navigate('settings');$('#passwordForm input[name="currentPassword"]').focus();return}
  if(action==='local'){location.href='http://127.0.0.1:3000/';return}
  if(action==='retry'){
    event.currentTarget.classList.add('button-busy');
    try{await syncFromBackend();renderAll();connectLiveSync();showToast('已连接统一数据库','连接成功')}
    catch(error){if(error.status===401)showLogin();else showToast(error.message,'仍未连接')}
    finally{event.currentTarget.classList.remove('button-busy')}
  }
});
$('#passwordForm').addEventListener('submit',async event=>{
  event.preventDefault();const d=Object.fromEntries(new FormData(event.target)),button=$('button[type="submit"]',event.target);if(d.newPassword!==d.confirmPassword){showToast('两次输入的新密码不一致','无法保存');return}if(!backendEnabled){showToast('演示模式不能修改登录密码','尚未连接后台');return}button.classList.add('button-busy');
  try{await apiRequest('/api/account/password',{method:'POST',body:JSON.stringify({currentPassword:d.currentPassword,newPassword:d.newPassword})});await syncFromBackend();event.target.reset();renderAll();showToast('新密码已经生效','修改成功')}
  catch(error){showToast(error.message,'修改失败')}finally{button.classList.remove('button-busy')}
});
$('#addUser').addEventListener('click',()=>{$('#userForm').reset();$('#userDialog').showModal()});
$('#userForm').addEventListener('submit',async event=>{
  event.preventDefault();const d=Object.fromEntries(new FormData(event.target)),button=$('button[type="submit"]',event.target);button.classList.add('button-busy');
  try{await apiRequest('/api/users',{method:'POST',body:JSON.stringify(d)});await syncFromBackend();$('#userDialog').close();renderSettings();showToast('用户已创建，首次登录需修改密码')}
  catch(error){showToast(error.message,'创建失败')}finally{button.classList.remove('button-busy')}
});
$('#createBackup').addEventListener('click',async()=>{
  const button=$('#createBackup');button.classList.add('button-busy');
  try{await apiRequest('/api/backups',{method:'POST',body:'{}'});await syncFromBackend();renderSettings();showToast('数据库和附件已经备份')}
  catch(error){showToast(error.message,'备份失败')}finally{button.classList.remove('button-busy')}
});
$('#archiveUploadForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target,file=form.elements.file.files[0],stage=Number(form.elements.stage.value),button=$('button[type="submit"]',form);if(!file)return;if(file.size>30*1024*1024){showToast('单个文件不能超过 30 MB','文件过大');return}if(!backendEnabled){showToast('演示模式不能保存真实文件','尚未连接后台');return}button.classList.add('button-busy');
  const category=form.elements.category.value;
  try{await apiRequest(`/api/projects/${archiveProjectId}/documents?stage=${stage}&category=${encodeURIComponent(category)}&filename=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});await syncFromBackend(archiveProjectId);form.reset();$('#archiveStageSelect').value=String(projects.find(item=>item.id===archiveProjectId)?.current||1);renderArchiveFiles();showToast('文件已归档')}
  catch(error){showToast(error.message,'归档失败')}finally{button.classList.remove('button-busy')}
});
document.addEventListener('click',event=>{if(!event.target.closest('.project-selector'))$('#projectMenu').classList.remove('open')});
$('#loginDialog').addEventListener('cancel',event=>event.preventDefault());
$('#loginForm').addEventListener('submit',async event=>{
  event.preventDefault();const d=Object.fromEntries(new FormData(event.target)),button=$('button[type="submit"]',event.target);button.classList.add('button-busy');$('#loginError').textContent='';
  try{await apiRequest('/api/login',{method:'POST',body:JSON.stringify(d)});await syncFromBackend();$('#loginDialog').close();renderAll();connectLiveSync();if(currentUser?.mustChangePassword)navigate('settings');showToast(currentUser?.mustChangePassword?'请先修改初始密码':'已连接统一数据库','登录成功')}
  catch(error){showLogin(error.message)}finally{button.classList.remove('button-busy')}
});
$('#logoutButton').addEventListener('click',async()=>{
  try{await apiRequest('/api/logout',{method:'POST',body:'{}'})}catch{}
  stopLiveSync();backendEnabled=false;currentUser=null;$('#logoutButton').hidden=true;renderModeBanner();showLogin('已安全退出');
});

initialize();
