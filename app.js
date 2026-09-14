const CATEGORIES = {
  expense:['식비','카페','마트/생활','교통','주유','쇼핑','병원/약','공과금','회비','여행','교육','기타'],
  income:['급여','용돈','환급','이자','기타수입']
};
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const money=n=>`${Number(n||0).toLocaleString('ko-KR')}원`;
const localDateString=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>localDateString();
let currentType='expense', currentImageBlob=null, recognition=null, finalSpeech='';
let selectedYM=today().slice(0,7), showAllSelectedMonth=false, editingId=null, editingExistingImage=null;

function setStatus(msg, timeout=3500){const el=$('#statusBox');el.textContent=msg;el.classList.remove('hidden');if(timeout)setTimeout(()=>el.classList.add('hidden'),timeout)}
function categoriesFor(type){return CATEGORIES[type]||CATEGORIES.expense}
function fillCategories(type, selected){const s=$('#categoryInput');s.innerHTML='';categoriesFor(type).forEach(c=>{const o=document.createElement('option');o.textContent=c;o.value=c;s.appendChild(o)});if(selected&&[...s.options].some(o=>o.value===selected))s.value=selected}
function setType(type, selectedCategory){currentType=type;$$('.type-btn').forEach(b=>b.classList.toggle('active',b.dataset.type===type));fillCategories(type,selectedCategory)}
function resetForm(){currentImageBlob=null;editingId=null;editingExistingImage=null;$('#receiptPreviewWrap').classList.add('hidden');$('#speechTextWrap').classList.add('hidden');$('#dateInput').value=today();$('#amountInput').value='';$('#merchantInput').value='';$('#memoInput').value='';$('#paymentInput').value='카드';$('#saveBtn').textContent='확인하고 저장';setType('expense');}
function openEntry(title='내용 확인'){ $('#entryPanelTitle').textContent=title; $('#entryPanel').classList.remove('hidden'); setTimeout(()=>$('#entryPanel').scrollIntoView({behavior:'smooth',block:'start'}),80); }

const DB_NAME='talking-ledger-db', STORE='records';
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id',autoIncrement:true})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function dbAdd(record){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).add(record);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function dbPut(record){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(record);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function dbAll(){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly');const rq=tx.objectStore(STORE).getAll();rq.onsuccess=()=>res(rq.result||[]);rq.onerror=()=>rej(rq.error)})}
async function dbDelete(id){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function dbClearAndPut(records){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');const st=tx.objectStore(STORE);st.clear();records.forEach(r=>st.put(r));tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}

function parseKoreanNumberToken(raw){
  if(!raw)return null; raw=raw.replace(/[\s,원]/g,'');
  if(/^\d+(?:\.\d+)?$/.test(raw))return Number(raw);
  const digit={'영':0,'공':0,'일':1,'이':2,'삼':3,'사':4,'오':5,'육':6,'칠':7,'팔':8,'구':9};
  const unit={'십':10,'백':100,'천':1000}; let total=0, section=0, num=0, found=false;
  for(const ch of raw){
    if(ch in digit){num=digit[ch];found=true;continue}
    if(ch in unit){section+=(num||1)*unit[ch];num=0;found=true;continue}
    if(ch==='만'){section+=num; total+=(section||1)*10000; section=0;num=0;found=true;continue}
    return null;
  }
  return found?total+section+num:null;
}
function extractAmount(text){
  const normalized=text.replace(/,/g,'');
  const arabic=[...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(만|천|백)?\s*원?/g)].map(m=>({raw:m[0],base:Number(m[1]),unit:m[2],idx:m.index}));
  let candidates=arabic.map(x=>{let mult=1;if(x.unit==='만')mult=10000;if(x.unit==='천')mult=1000;if(x.unit==='백')mult=100;return {value:Math.round(x.base*mult),idx:x.idx,raw:x.raw}}).filter(x=>x.value>0);
  const korean=[...normalized.matchAll(/([일이삼사오육칠팔구십백천만]+)\s*원/g)].map(m=>({value:parseKoreanNumberToken(m[1]),idx:m.index,raw:m[0]})).filter(x=>x.value>0);
  candidates=candidates.concat(korean).sort((a,b)=>a.idx-b.idx);
  if(!candidates.length)return null;
  const withWon=candidates.filter(c=>/원/.test(c.raw));
  return (withWon.length?withWon: candidates)[0].value;
}
function extractDate(text){
  const d=new Date(); if(/그제|그저께/.test(text))d.setDate(d.getDate()-2); else if(/어제/.test(text))d.setDate(d.getDate()-1); else if(/오늘/.test(text)){} else {
    const m=text.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/); if(m){const y=Number(m[1]||d.getFullYear());return `${y}-${String(+m[2]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`}
  }
  return localDateString(d)
}
function inferPayment(text){if(/현금/.test(text))return'현금';if(/계좌|이체|송금/.test(text))return'계좌이체';if(/카드|신용|체크/.test(text))return'카드';return'카드'}
function inferType(text){return /월급|급여|입금|수입|받았|환급|이자/.test(text)?'income':'expense'}
function inferCategory(text,type){
  const rules= type==='income' ? [
    ['급여',/월급|급여|상여/],['환급',/환급|돌려받/],['이자',/이자/],['용돈',/용돈/]
  ] : [
    ['식비',/밥|점심|저녁|아침|식사|김치|국밥|고기|회식|치킨|피자|배달/],['카페',/커피|카페|스타벅스|투썸|메가커피/],['마트/생활',/마트|이마트|롯데마트|홈플러스|생필품|세제|휴지/],['교통',/버스|택시|지하철|기차|KTX|교통/],['주유',/주유|휘발유|경유|기름/],['쇼핑',/쇼핑|옷|신발|의류|쿠팡|온라인/],['병원/약',/병원|약국|진료|약값|의원/],['공과금',/전기|수도|가스|통신|핸드폰|관리비|공과금/],['회비',/회비|모임/],['여행',/호텔|숙소|여행|항공|비행기/],['교육',/학원|교육|수강|책/]
  ];
  for(const [cat,re] of rules)if(re.test(text))return cat; return type==='income'?'기타수입':'기타';
}
function looksLikeQuery(text){return /(얼마|합계|보여줘|내역|썼어|썼지|지출|수입).*(이번 달|오늘|어제)|^(이번 달|오늘|어제).*(얼마|합계|내역|썼어|지출|수입)/.test(text)}
async function answerQuery(text){
  const rows=await dbAll(); const now=new Date(); let start,end,label;
  if(/오늘/.test(text)){start=today();end=start;label='오늘'} else if(/어제/.test(text)){const d=new Date();d.setDate(d.getDate()-1);start=end=localDateString(d);label='어제'} else {const m=String(now.getMonth()+1).padStart(2,'0');start=`${now.getFullYear()}-${m}-01`;end=`${now.getFullYear()}-${m}-31`;label='이번 달'}
  let cat=null;[...CATEGORIES.expense,...CATEGORIES.income].forEach(c=>{if(text.includes(c.split('/')[0]))cat=c});
  const type=/수입/.test(text)?'income':'expense'; const filtered=rows.filter(r=>r.date>=start&&r.date<=end&&r.type===type&&(!cat||r.category===cat)); const total=filtered.reduce((s,r)=>s+Number(r.amount||0),0);
  const answer=`${label}${cat?' '+cat:''} ${type==='income'?'수입':'지출'}은 ${money(total)}입니다.`; setStatus(answer,6000); if('speechSynthesis'in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(answer))} return answer;
}
function parseSpeech(text){const type=inferType(text);return{type,date:extractDate(text),amount:extractAmount(text),category:inferCategory(text,type),payment:inferPayment(text),merchant:'',memo:text}}
function applyParsed(p,text){setType(p.type,p.category);$('#dateInput').value=p.date||today();$('#amountInput').value=p.amount||'';$('#paymentInput').value=p.payment||'카드';$('#merchantInput').value=p.merchant||'';$('#memoInput').value=p.memo||'';if(text){$('#speechText').textContent=text;$('#speechTextWrap').classList.remove('hidden')}}

function setupVoice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){$('#voiceBtn').addEventListener('click',()=>setStatus('이 브라우저에서는 음성인식을 지원하지 않습니다. Chrome에서 사용해 주세요.',6000));return}
  recognition=new SR(); recognition.lang='ko-KR';recognition.interimResults=true;recognition.continuous=false;
  recognition.onstart=()=>{finalSpeech='';$('#voiceOverlay').classList.remove('hidden');$('#voiceLiveText').textContent='말씀해 주세요.'};
  recognition.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)finalSpeech+=t;else interim+=t}$('#voiceLiveText').textContent=finalSpeech||interim||'말씀해 주세요.'};
  recognition.onerror=e=>{setStatus(`음성인식 오류: ${e.error}`,5000);$('#voiceOverlay').classList.add('hidden')};
  recognition.onend=async()=>{$('#voiceOverlay').classList.add('hidden');const text=finalSpeech.trim();if(!text)return;if(looksLikeQuery(text)){await answerQuery(text);return}resetForm();applyParsed(parseSpeech(text),text);openEntry('말한 내용 확인')};
  $('#voiceBtn').addEventListener('click',()=>{try{recognition.start()}catch(e){}});$('#stopVoiceBtn').addEventListener('click',()=>recognition.stop());
}

function parseReceiptText(text){
  const lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  let amount=null;
  const priority=lines.filter(l=>/합계|총액|결제금액|받을금액|승인금액|총\s*금액/i.test(l));
  for(const l of priority){const nums=[...l.replace(/,/g,'').matchAll(/\d{2,9}/g)].map(m=>Number(m[0])).filter(n=>n>=100);if(nums.length){amount=Math.max(...nums);break}}
  if(!amount){const nums=[...text.replace(/,/g,'').matchAll(/\b\d{3,9}\b/g)].map(m=>m[0]).filter(v=>!(v.length===8&&v.startsWith('20'))).map(Number).filter(n=>n>=100&&n<10000000);if(nums.length)amount=Math.max(...nums)}
  let date=today(); const dm=text.match(/(20\d{2})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/); if(dm)date=`${dm[1]}-${String(+dm[2]).padStart(2,'0')}-${String(+dm[3]).padStart(2,'0')}`;
  const merchant=lines.find(l=>l.length>=2&&l.length<=30&&!/영수증|카드|승인|사업자|전화|TEL|합계|금액|부가세|주소|매출/i.test(l)&&!/^\d/.test(l))||'';
  const joined=text.replace(/\s+/g,' '); const category=inferCategory(joined,'expense');
  return{type:'expense',date,amount,category,payment:/현금/.test(text)?'현금':'카드',merchant,memo:'영수증'};
}
async function handleImage(file){
  if(!file)return;resetForm();currentImageBlob=file;const url=URL.createObjectURL(file);$('#receiptPreview').src=url;$('#receiptPreviewWrap').classList.remove('hidden');openEntry('영수증 확인');
  if(!window.Tesseract){$('#ocrStateText').textContent='자동 인식 모듈을 불러오지 못했습니다';setStatus('금액을 직접 입력해도 저장할 수 있습니다.',5000);return}
  $('#ocrStateText').textContent='영수증 읽는 중';$('#ocrProgress').textContent='0%';
  try{
    const worker=await Tesseract.createWorker('kor+eng',1,{logger:m=>{if(m.status==='recognizing text')$('#ocrProgress').textContent=`${Math.round((m.progress||0)*100)}%`}});
    const result=await worker.recognize(file);await worker.terminate();const text=result.data.text||'';applyParsed(parseReceiptText(text));$('#ocrStateText').textContent='자동 인식 완료 — 금액을 확인하세요';$('#ocrProgress').textContent='';
  }catch(e){console.error(e);$('#ocrStateText').textContent='자동 인식 실패 — 직접 입력해 주세요';$('#ocrProgress').textContent='';setStatus('영수증 자동 인식에 실패했습니다. 사진은 그대로 저장할 수 있습니다.',5000)}
}

async function saveCurrent(){
  const amount=Number($('#amountInput').value); if(!amount||amount<0){setStatus('금액을 확인해 주세요.',4500);$('#amountInput').focus();return}
  const record={type:currentType,date:$('#dateInput').value||today(),amount,category:$('#categoryInput').value,payment:$('#paymentInput').value,merchant:$('#merchantInput').value.trim(),memo:$('#memoInput').value.trim(),image:currentImageBlob||editingExistingImage||null,createdAt:new Date().toISOString()};
  if(editingId){record.id=editingId;const rows=await dbAll();const old=rows.find(r=>r.id===editingId);if(old?.createdAt)record.createdAt=old.createdAt;record.updatedAt=new Date().toISOString();await dbPut(record);}else{await dbAdd(record)}
  const wasEditing=!!editingId;selectedYM=record.date.slice(0,7);showAllSelectedMonth=false;$('#entryPanel').classList.add('hidden');resetForm();await render();setStatus(wasEditing?'수정했습니다.':'저장했습니다.');
}
async function editRecord(id){
  const rows=await dbAll();const r=rows.find(x=>x.id===id);if(!r){setStatus('기록을 찾을 수 없습니다.');return}
  resetForm();editingId=r.id;editingExistingImage=r.image||null;setType(r.type||'expense',r.category);$('#dateInput').value=r.date||today();$('#amountInput').value=r.amount||'';$('#paymentInput').value=r.payment||'기타';$('#merchantInput').value=r.merchant||'';$('#memoInput').value=r.memo||'';$('#saveBtn').textContent='수정 내용 저장';openEntry('내역 수정');
}
function ymLabel(ym){const [y,m]=ym.split('-');return `${Number(y)}년 ${Number(m)}월`}
function moveMonth(ym,delta){const [y,m]=ym.split('-').map(Number);const d=new Date(y,m-1+delta,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`}
function daysInYM(ym){const [y,m]=ym.split('-').map(Number);return new Date(y,m,0).getDate()}
function monthTotals(rows,ym){const month=rows.filter(r=>r.date?.startsWith(ym));const expense=month.filter(r=>r.type==='expense').reduce((s,r)=>s+Number(r.amount||0),0);const income=month.filter(r=>r.type==='income').reduce((s,r)=>s+Number(r.amount||0),0);return{month,expense,income}}
function renderMonthlyBars(rows){
  const wrap=$('#monthlyBars');wrap.innerHTML='';const months=[];for(let i=5;i>=0;i--)months.push(moveMonth(today().slice(0,7),-i));
  const vals=months.map(ym=>({ym,value:monthTotals(rows,ym).expense}));const max=Math.max(1,...vals.map(v=>v.value));
  vals.forEach(({ym,value})=>{const btn=document.createElement('button');btn.className=`month-row ${ym===selectedYM?'active':''}`;btn.innerHTML=`<span class="month-name">${Number(ym.slice(5))}월</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.round(value/max*100)}%"></span></span><span class="month-value">${money(value)}</span>`;btn.onclick=()=>{selectedYM=ym;showAllSelectedMonth=false;render()};wrap.appendChild(btn)});
}
function renderCategories(monthRows,totalExpense){
  $('#categoryMonthLabel').textContent=ymLabel(selectedYM);const wrap=$('#categoryBreakdown');wrap.innerHTML='';
  const sums={};monthRows.filter(r=>r.type==='expense').forEach(r=>sums[r.category]=(sums[r.category]||0)+Number(r.amount||0));
  const items=Object.entries(sums).sort((a,b)=>b[1]-a[1]);if(!items.length){wrap.innerHTML='<div class="cat-empty">이 달의 지출 기록이 없습니다.</div>';return}
  items.forEach(([cat,value])=>{const pct=totalExpense?Math.round(value/totalExpense*100):0;const el=document.createElement('div');el.className='cat-row';el.innerHTML=`<span class="cat-name">${escapeHtml(cat)}</span><span class="cat-track"><span class="cat-fill" style="display:block;width:${pct}%"></span></span><span class="cat-value">${money(value)} · ${pct}%</span>`;wrap.appendChild(el)});
}
async function render(){
  const rows=(await dbAll()).sort((a,b)=>(b.date+(b.createdAt||'')).localeCompare(a.date+(a.createdAt||'')));const {month,expense:exp,income:inc}=monthTotals(rows,selectedYM);
  $('#monthLabel').textContent=ymLabel(selectedYM);$('#monthInput').value=selectedYM;$('#expenseLabel').textContent=`${Number(selectedYM.slice(5))}월 지출`;$('#monthExpense').textContent=money(exp);$('#monthIncome').textContent=money(inc);$('#monthBalance').textContent=money(inc-exp);$('#monthCount').textContent=`${month.length}건`;
  const currentYM=today().slice(0,7);const days=selectedYM===currentYM?Math.max(1,new Date().getDate()):daysInYM(selectedYM);$('#dailyAverage').textContent=money(Math.round(exp/days));
  renderMonthlyBars(rows);renderCategories(month,exp);
  const list=$('#recentList');list.innerHTML='';const shown=showAllSelectedMonth?month:month.slice(0,8);$('#emptyState').classList.toggle('hidden',shown.length>0);$('#showAllBtn').textContent=showAllSelectedMonth?'간단히 보기':'선택 월 전체';
  const icons={'식비':'🍚','카페':'☕','마트/생활':'🛒','교통':'🚌','주유':'⛽','쇼핑':'🛍️','병원/약':'💊','공과금':'💡','회비':'👥','여행':'✈️','교육':'📚','급여':'💰','용돈':'💵','환급':'↩️','이자':'🏦'};
  shown.forEach(r=>{const el=document.createElement('div');el.className='record';const title=r.merchant||r.memo||r.category;el.innerHTML=`<div class="record-icon">${icons[r.category]|| (r.type==='income'?'💰':'🧾')}</div><div class="record-main"><b>${escapeHtml(title)}</b><span>${r.date} · ${escapeHtml(r.category)} · ${escapeHtml(r.payment||'')}</span></div><div class="record-side"><div class="record-amount ${r.type==='income'?'income':''}">${r.type==='income'?'+':'-'}${money(r.amount)}</div><div class="record-actions"><button class="record-edit" data-id="${r.id}" type="button">수정</button><button class="record-delete" data-id="${r.id}" type="button">삭제</button></div></div>`;list.appendChild(el)});
  $$('.record-edit').forEach(b=>b.addEventListener('click',()=>editRecord(Number(b.dataset.id))));
  $$('.record-delete').forEach(b=>b.addEventListener('click',async()=>{if(confirm('이 내역을 정말 삭제할까요?\n삭제하면 되돌릴 수 없습니다.')){await dbDelete(Number(b.dataset.id));await render();setStatus('삭제했습니다.')}}));
}
function escapeHtml(s=''){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function download(name,content,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function exportCSV(){const rows=await dbAll();const header=['날짜','구분','금액','분류','결제','상호','메모'];const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;const body=rows.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>[r.date,r.type==='income'?'수입':'지출',r.amount,r.category,r.payment,r.merchant,r.memo].map(q).join(','));download(`말하는가계부_${today()}.csv`,'\ufeff'+[header.map(q).join(','),...body].join('\n'),'text/csv;charset=utf-8')}
async function exportJSON(){const rows=await dbAll();const safe=[];for(const r of rows){const copy={...r};if(copy.image){copy.imageBase64=await blobToDataURL(copy.image);delete copy.image}safe.push(copy)}download(`말하는가계부_백업_${today()}.json`,JSON.stringify({app:'말하는 가계부',exportedAt:new Date().toISOString(),records:safe},null,2),'application/json')}
function blobToDataURL(blob){return new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.readAsDataURL(blob)})}
async function dataURLToBlob(data){const r=await fetch(data);return r.blob()}
async function importJSON(file){try{const data=JSON.parse(await file.text());if(!Array.isArray(data.records))throw new Error('형식 오류');if(!confirm(`백업 기록 ${data.records.length}건으로 현재 가계부를 교체할까요?`))return;const rows=[];for(const r of data.records){const copy={...r};if(copy.imageBase64){copy.image=await dataURLToBlob(copy.imageBase64);delete copy.imageBase64}rows.push(copy)}await dbClearAndPut(rows);await render();setStatus('백업을 불러왔습니다.',5000)}catch(e){setStatus('백업 파일을 읽을 수 없습니다.',5000)}}

function init(){
  resetForm();setupVoice();render();
  $('#manualBtn').onclick=()=>{resetForm();openEntry('직접 입력')};
  $('#addRecordBtn').onclick=()=>{resetForm();$('#dateInput').value=selectedYM===today().slice(0,7)?today():selectedYM+'-01';openEntry('내역 추가')};
  $('#expenseQuickBtn').onclick=()=>{resetForm();setType('expense');openEntry('지출 입력')};
  $('#incomeQuickBtn').onclick=()=>{resetForm();setType('income');$('#paymentInput').value='계좌이체';openEntry('수입 입력')};
  $('#voiceQuickBtn').onclick=()=>$('#voiceBtn').click();
  $('#cameraBtn').onclick=()=>$('#cameraInput').click();$('#galleryBtn').onclick=()=>$('#galleryInput').click();$('#cameraInput').onchange=e=>handleImage(e.target.files[0]);$('#galleryInput').onchange=e=>handleImage(e.target.files[0]);
  $$('.type-btn').forEach(b=>b.onclick=()=>setType(b.dataset.type));$('#saveBtn').onclick=saveCurrent;$('#closeEntryBtn').onclick=()=>{$('#entryPanel').classList.add('hidden');resetForm()};
  $('#showAllBtn').onclick=()=>{showAllSelectedMonth=!showAllSelectedMonth;render()};
  $('#prevMonthBtn').onclick=()=>{selectedYM=moveMonth(selectedYM,-1);showAllSelectedMonth=false;render()};
  $('#nextMonthBtn').onclick=()=>{selectedYM=moveMonth(selectedYM,1);showAllSelectedMonth=false;render()};
  $('#goCurrentMonthBtn').onclick=()=>{selectedYM=today().slice(0,7);showAllSelectedMonth=false;render()};
  $('#monthPickerBtn').onclick=()=>{const input=$('#monthInput');if(input.showPicker)input.showPicker();else input.click()};
  $('#monthInput').onchange=e=>{if(e.target.value){selectedYM=e.target.value;showAllSelectedMonth=false;render()}};
  $('#openMoreBtn').onclick=()=>$('#moreSheet').classList.remove('hidden');$('#closeMoreBtn').onclick=()=>$('#moreSheet').classList.add('hidden');$('#moreSheet').addEventListener('click',e=>{if(e.target.id==='moreSheet')e.currentTarget.classList.add('hidden')});
  $('#exportCsvBtn').onclick=exportCSV;$('#exportJsonBtn').onclick=exportJSON;$('#importJsonInput').onchange=e=>importJSON(e.target.files[0]);
}
init();
