(() => {
  'use strict';
  const $ = (s, p=document) => p.querySelector(s);
  const $$ = (s, p=document) => [...p.querySelectorAll(s)];
  const state = {
    songs: [], filtered: [], queue: [], played: new Set(), notes: {},
    config: null, pendingConfirm: null, customSongs: [], customRepertoires: [], newSongElenaNotes: null, songEdits: {}, editSongElenaNotes: null
  };
  const dialogBaselines = new WeakMap();
  const trackedDialogIds = new Set(['newSongDialog','repertoiresDialog','editSongDialog','songbookEditorDialog','photoManagerDialog','securityDialog']);
  const labels = {alto:'Alto potencial', medio:'Potencial medio', bajo:'Bajo potencial'};
  const fallbackRepertoires = [{id:'todas',name:'Todas las canciones'}];
  let remoteStateRef = null;
  let remoteReady = false;
  let remoteWriteTimer = 0;

  async function initRemoteSync(){
    if(!navigator.onLine) return;
    try{
      const [{ initializeApp }, { doc, getFirestore, onSnapshot, setDoc: firebaseSetDoc }] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js')
      ]);
      const response=await fetch('configuracion.json');
      const cfg=await response.json();
      if(!cfg?.firebase?.apiKey||!cfg?.firebase?.projectId) return;
      const app=initializeApp(cfg.firebase,'panel-v3');
      remoteStateRef=doc(getFirestore(app),'config','estado');
      window.__egmSetDoc=firebaseSetDoc;
      onSnapshot(remoteStateRef,snap=>{
        if(!snap.exists()) return;
        const data=snap.data()||{};
        if(Array.isArray(data.cola)) state.queue=[...data.cola];
        if(Array.isArray(data.tocadas)) state.played=new Set(data.tocadas);
        if(state.config){
          state.config.whatsapp=data.pedidos_whatsapp!==false;
          state.config.publicQueue=data.mostrar_cola!==false;
          $('#whatsappToggle').checked=state.config.whatsapp;
          $('#publicQueueToggle').checked=state.config.publicQueue;
        }
        remoteReady=true;
        renderQueue();
        if(document.body.classList.contains('live-mode')) renderSongs();
      },err=>console.warn('Sincronización remota no disponible',err));
    }catch(err){ console.warn('No se pudo iniciar la sincronización remota',err); }
  }

  function syncRemoteState(immediate=false){
    if(!remoteStateRef) return;
    clearTimeout(remoteWriteTimer);
    const write=async()=>{
      const cfg=state.config||{};
      try{
        await window.__egmSetDoc(remoteStateRef,{
          lista_activa:cfg.repertoire||'todas',
          listaActiva:cfg.repertoire||'todas',
          pedidos_whatsapp:cfg.whatsapp!==false,
          mostrar_cola:cfg.publicQueue!==false,
          lugar:cfg.venue||'',
          perfil_clientes:cfg.profile||'medio',
          show_activo:Boolean(state.config),
          inicio_show:cfg.startedAt?new Date(cfg.startedAt).getTime():Date.now(),
          cola:[...state.queue],
          tocadas:[...state.played]
        },{merge:true});
        remoteReady=true;
      }catch(err){ console.warn('No se pudo actualizar la interfaz del cliente',err); }
    };
    if(immediate) write(); else remoteWriteTimer=setTimeout(write,80);
  }

  async function loadData(){
    try{
      const [songsRes, notesRes] = await Promise.all([fetch('canciones.json'),fetch('assets/anotaciones/index.json')]);
      state.songs = await songsRes.json();
      if(notesRes.ok) state.notes = await notesRes.json();
    }catch(err){
      console.warn('No se pudo usar fetch; cargando demostración.',err);
      state.songs = [
        {id:'demo1',titulo:'A la la Long',artista:'Inner Circle',listas:['todas','principal-diario']},
        {id:'demo2',titulo:'Back to Black',artista:'Amy Winehouse',listas:['todas','principal-diario']},
        {id:'demo3',titulo:'Como la flor',artista:'Selena',listas:['todas','principal-diario']}
      ];
    }
    hydrateSavedState();
    buildRepertoires();
  }

  function hydrateSavedState(){
    const saved = JSON.parse(localStorage.getItem('egm-panel-v3') || '{}');
    state.config = saved.config || null;
    state.customSongs = Array.isArray(saved.customSongs) ? saved.customSongs : [];
    state.songEdits = saved.songEdits && typeof saved.songEdits==='object' ? saved.songEdits : {};
    state.songs = state.songs.map(song=>state.songEdits[song.id] ? {...song,...state.songEdits[song.id]} : song);
    state.customRepertoires = Array.isArray(saved.customRepertoires) ? saved.customRepertoires : [];
    state.songs = [...state.songs, ...state.customSongs];
    sortMasterSongs();
    state.queue = Array.isArray(saved.queue) ? saved.queue : [];
    state.played = new Set(Array.isArray(saved.played) ? saved.played : []);
    (saved.venues || []).forEach(v => addVenueOption(v));
    if(state.config){
      $('#venueInput').value = state.config.venue || '';
      $('#profileSelect').value = state.config.profile || 'alto';
      $('#whatsappToggle').checked = state.config.whatsapp !== false;
      $('#publicQueueToggle').checked = state.config.publicQueue !== false;
      setStatus(true);
    }
  }

  function saveState(){
    const venues = $$('#venueHistory option').map(o=>o.value);
    localStorage.setItem('egm-panel-v3',JSON.stringify({config:state.config,queue:state.queue,played:[...state.played],venues,customSongs:state.customSongs,customRepertoires:state.customRepertoires,songEdits:state.songEdits}));
    syncRemoteState();
  }

  function buildRepertoires(){
    const map = new Map(fallbackRepertoires.map(x=>[x.id,x.name]));
    state.customRepertoires.forEach(x=>map.set(x.id,x.name));
    state.songs.forEach(song => (song.listas||[]).forEach(id=>{
      if(!map.has(id)) map.set(id, titleFromId(id));
    }));
    const select=$('#repertoireSelect');
    select.innerHTML='';
    [...map].sort((a,b)=>a[1].localeCompare(b[1],'es')).forEach(([id,name])=>select.add(new Option(name,id)));
    select.value = state.config?.repertoire || (map.has('principal-diario')?'principal-diario':'todas');
  }

  function titleFromId(id){ return id.split('-').map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' '); }
  function sortMasterSongs(){
    state.songs.sort((a,b)=>String(a.titulo||'').localeCompare(String(b.titulo||''),'es',{sensitivity:'base'}) || String(a.artista||'').localeCompare(String(b.artista||''),'es',{sensitivity:'base'}));
    state.songs.forEach((song,index)=>{ song.numero=index+1; });
  }
  function addVenueOption(value){
    if(!value || $(`#venueHistory option[value="${CSS.escape(value)}"]`)) return;
    const o=document.createElement('option');o.value=value;$('#venueHistory').append(o);
  }
  function setStatus(active){
    const chip=$('#statusChip');chip.textContent=active?'Show activo':'Sin show activo';chip.classList.toggle('active',active);
  }

  $('#showForm').addEventListener('submit',e=>{
    e.preventDefault();
    const venue=$('#venueInput').value.trim();
    if(!venue) return toast('Escribe el lugar del show');
    const config={venue,repertoire:$('#repertoireSelect').value,repertoireName:$('#repertoireSelect').selectedOptions[0].textContent,profile:$('#profileSelect').value,whatsapp:$('#whatsappToggle').checked,publicQueue:$('#publicQueueToggle').checked,startedAt:new Date().toISOString()};
    askConfirm('Comenzar nuevo show','Se guardará esta configuración y se reiniciará la cola del show anterior.',()=>{
      state.config=config;state.queue=[];state.played.clear();addVenueOption(venue);saveState();setStatus(true);showLive();toast('Configuración guardada correctamente. El show ha comenzado.');
    },'Comenzar');
  });

  function showLive(){
    if(!state.config) return toast('Primero configura el show');
    document.body.classList.add('live-mode');
    $('#configView').classList.remove('is-active');$('#liveView').classList.add('is-active');
    $('#liveRepertoireName').textContent=state.config.repertoireName || 'Repertorio';
    $('#songSearch').value='';filterSongs();renderQueue();window.scrollTo({top:0,behavior:'smooth'});
  }
  function showConfig(){ document.body.classList.remove('live-mode');$('#liveView').classList.remove('is-active');$('#configView').classList.add('is-active');window.scrollTo({top:0,behavior:'smooth'}); }

  $('#backConfigBtn').addEventListener('click',()=>askConfirm('Volver a configuración','El show continuará activo. ¿Deseas salir de esta pantalla?',showConfig,'Volver'));
  $('#finishShowBtn').addEventListener('click',()=>askConfirm('Finalizar show','Se cerrará el show actual y se limpiará la cola.',()=>{state.config=null;state.queue=[];state.played.clear();saveState();setStatus(false);showConfig();toast('Show finalizado');},'Finalizar'));
  $('#closePanelBtn').addEventListener('click',()=>askConfirm('Cerrar el panel','¿Deseas cerrar esta pantalla?',()=>{window.location.href='index.html';},'Cerrar'));
  $('#exitPanelBtn').addEventListener('click',()=>askConfirm('Salir del panel','¿Deseas regresar a la página principal?',()=>{window.location.href='index.html';},'Salir'));

  $('#songSearch').addEventListener('input',filterSongs);
  function repertoireSongs(){
    const rep=state.config?.repertoire || 'todas';
    return state.songs.filter(s=>rep==='todas'||(s.listas||[]).includes(rep));
  }
  function filterSongs(){
    const q=norm($('#songSearch').value);
    const songs=repertoireSongs();
    if(!q){
      state.filtered=songs;
    }else{
      const isNumber=/^\d+$/.test(q);
      state.filtered=songs.map((song,index)=>{
        const title=norm(song.titulo);
        const artist=norm(song.artista);
        const number=String(song.numero||'');
        let score=Infinity;
        if(isNumber){
          if(number===q) score=0;
          else if(number.startsWith(q)) score=1;
          else if(number.includes(q)) score=2;
        }else{
          const titleWords=title.split(/\s+/);
          const artistWords=artist.split(/\s+/);
          if(title.startsWith(q)) score=0;
          else if(titleWords.some(word=>word.startsWith(q))) score=1;
          else if(artist.startsWith(q)) score=2;
          else if(artistWords.some(word=>word.startsWith(q))) score=3;
          else if(title.includes(q)) score=4;
          else if(artist.includes(q)) score=5;
        }
        return {song,index,score};
      }).filter(item=>Number.isFinite(item.score))
        .sort((a,b)=>a.score-b.score||a.index-b.index)
        .map(item=>item.song);
    }
    renderSongs();
  }
  function renderSongs(){
    const list=$('#songList');list.innerHTML='';
    $('#songCount').textContent=`${state.filtered.length} temas`;
    state.filtered.forEach((song,index)=>{
      const queued=state.queue.includes(song.id), played=state.played.has(song.id);
      const card=document.createElement('article');card.className=`song-card${queued?' is-queued':''}${played?' is-played':''}`;
      card.innerHTML=`<div class="song-info"><div class="song-title-row"><span class="song-number">${String(song.numero||index+1).padStart(2,'0')}</span><span class="song-title">${esc(song.titulo)}</span><span class="song-artist">${esc(song.artista||'Artista no indicado')}</span></div></div><div class="song-actions"><button class="song-action queue ${queued?'is-on':''}" data-act="queue">${queued?'En cola':'A la cola'}</button><button class="song-action played ${played?'is-on':''}" data-act="played">Tocada</button><button class="song-action lyrics" data-act="lyrics" title="Letra">Letra</button><button class="song-action notes" data-act="notes" title="Notas">Notas</button><button class="song-action daniel" data-act="daniel" title="Cancionero Daniel">Daniel</button></div>`;
      card.addEventListener('click',e=>{
        const button=e.target.closest('[data-act]');
        if(!button) return;
        const act=button.dataset.act;
        if(['queue','played','lyrics','notes','daniel'].includes(act)){
          requireSecondTap(song,act,button);
          return;
        }
      });
      list.append(card);
    });
    if(!state.filtered.length) list.innerHTML='<div class="viewer-empty"><h3>No se encontraron canciones</h3><p>Prueba con otro título, artista o número.</p></div>';
  }
  let pendingViewerTap=null;
  function requireSecondTap(song,act,button){
    const key=`${song.id}:${act}`;
    const now=Date.now();
    if(pendingViewerTap?.key===key && now-pendingViewerTap.time<=900){
      clearTimeout(pendingViewerTap.timer);
      pendingViewerTap.button?.classList.remove('is-awaiting-second-tap');
      pendingViewerTap=null;
      handleSongAction(song,act);
      return;
    }
    if(pendingViewerTap){
      clearTimeout(pendingViewerTap.timer);
      pendingViewerTap.button?.classList.remove('is-awaiting-second-tap');
    }
    button.classList.add('is-awaiting-second-tap');
    const labels={queue:'A la cola',played:'Tocada',lyrics:'Letra',notes:'Notas',daniel:'Daniel'};
    const label=labels[act]||'esta acción';
    toast(`Toca otra vez: ${label}`);
    const entry={key,time:now,button,timer:null};
    entry.timer=setTimeout(()=>{
      if(pendingViewerTap===entry) pendingViewerTap=null;
      button.classList.remove('is-awaiting-second-tap');
    },900);
    pendingViewerTap=entry;
  }

  function handleSongAction(song,act){
    if(act==='queue'){
      state.queue=state.queue.includes(song.id)?state.queue.filter(id=>id!==song.id):[...state.queue,song.id];
      saveState();renderQueue();renderSongs();toast(state.queue.includes(song.id)?'Canción agregada a la cola':'Canción retirada de la cola');
    } else if(act==='played'){
      state.played.has(song.id)?state.played.delete(song.id):state.played.add(song.id);
      saveState();renderQueue();renderSongs();toast(state.played.has(song.id)?'Marcada como tocada':'Estado Tocada retirado');
    } else if(act==='lyrics') openViewer(song,'lyrics');
    else if(act==='notes') openViewer(song,'notes');
    else if(act==='daniel') openViewer(song,'daniel');
  }

  function renderQueue(){
    const panel=$('#queuePanel'),list=$('#queueList');
    panel.hidden=false;list.innerHTML='';
    $('#queueCount').textContent=`${state.queue.length} ${state.queue.length===1?'canción':'canciones'}`;
    panel.classList.toggle('has-items', state.queue.length > 0);
    if(!state.queue.length){
      list.innerHTML='<div class="queue-empty">La cola está vacía</div>';
      return;
    }
    state.queue.map(id=>state.songs.find(s=>s.id===id)).filter(Boolean).forEach(song=>{
      const item=document.createElement('div');item.className=`queue-item${state.played.has(song.id)?' played':''}`;
      item.innerHTML=`<span class="queue-name"><b>${esc(song.titulo)}</b><small>${esc(song.artista||'')}</small></span><button class="mini-btn played-toggle ${state.played.has(song.id)?'is-on':''}" data-q="played">${state.played.has(song.id)?'Tocada':'Marcar tocada'}</button><button class="mini-btn remove" data-q="remove" aria-label="Quitar de la cola">×</button>`;
      item.addEventListener('click',e=>{
        const button=e.target.closest('[data-q]');
        if(!button)return;
        requireSecondQueueTap(song,button.dataset.q,button);
      });list.append(item);
    });
  }

  let pendingQueueTap=null;
  function requireSecondQueueTap(song,act,button){
    const key=`${song.id}:queue:${act}`;
    const now=Date.now();
    if(pendingQueueTap?.key===key && now-pendingQueueTap.time<=900){
      clearTimeout(pendingQueueTap.timer);
      pendingQueueTap.button?.classList.remove('is-awaiting-second-tap');
      pendingQueueTap=null;
      if(act==='played') state.played.has(song.id)?state.played.delete(song.id):state.played.add(song.id);
      if(act==='remove') state.queue=state.queue.filter(id=>id!==song.id);
      saveState();renderQueue();renderSongs();
      toast(act==='remove'?'Canción retirada de la cola':state.played.has(song.id)?'Marcada como tocada':'Estado Tocada retirado');
      return;
    }
    if(pendingQueueTap){
      clearTimeout(pendingQueueTap.timer);
      pendingQueueTap.button?.classList.remove('is-awaiting-second-tap');
    }
    button.classList.add('is-awaiting-second-tap');
    toast(act==='remove'?'Toca otra vez para quitar':'Toca otra vez: Tocada');
    const entry={key,time:now,button,timer:null};
    entry.timer=setTimeout(()=>{
      if(pendingQueueTap===entry) pendingQueueTap=null;
      button.classList.remove('is-awaiting-second-tap');
    },900);
    pendingQueueTap=entry;
  }


  const noteViewerState={scale:1,minScale:1,maxScale:5,x:0,y:0,pointers:new Map(),startDistance:0,startScale:1,startX:0,startY:0,originX:0,originY:0,lastTap:0};
  function resetNoteViewer(){
    Object.assign(noteViewerState,{scale:1,minScale:1,maxScale:5,x:0,y:0,startDistance:0,startScale:1,startX:0,startY:0,originX:0,originY:0,lastTap:0});
    noteViewerState.pointers.clear();
  }
  function applyNoteTransform(img){
    img.style.transform=`translate3d(${noteViewerState.x}px,${noteViewerState.y}px,0) scale(${noteViewerState.scale})`;
  }
  function clampNotePosition(img){
    const stage=$('#viewerContent');
    const maxX=Math.max(0,(img.clientWidth*noteViewerState.scale-stage.clientWidth)/2+24);
    const maxY=Math.max(0,(img.clientHeight*noteViewerState.scale-stage.clientHeight)/2+24);
    noteViewerState.x=Math.max(-maxX,Math.min(maxX,noteViewerState.x));
    noteViewerState.y=Math.max(-maxY,Math.min(maxY,noteViewerState.y));
  }
  function setNoteScale(img,nextScale,centerX=0,centerY=0){
    const previous=noteViewerState.scale;
    const next=Math.max(noteViewerState.minScale,Math.min(noteViewerState.maxScale,nextScale));
    if(previous!==next){
      const ratio=next/previous;
      noteViewerState.x=centerX-(centerX-noteViewerState.x)*ratio;
      noteViewerState.y=centerY-(centerY-noteViewerState.y)*ratio;
      noteViewerState.scale=next;
      if(next===noteViewerState.minScale){noteViewerState.x=0;noteViewerState.y=0;}
      clampNotePosition(img);applyNoteTransform(img);
    }
  }
  function installNoteGestures(img){
    const stage=$('#viewerContent');
    resetNoteViewer();
    stage.classList.add('is-note-viewer');
    img.classList.add('note-photo');
    img.draggable=false;
    const distance=()=>{const [a,b]=[...noteViewerState.pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
    const midpoint=()=>{const [a,b]=[...noteViewerState.pointers.values()];return {x:(a.x+b.x)/2-stage.clientWidth/2,y:(a.y+b.y)/2-stage.clientHeight/2};};
    img.addEventListener('pointerdown',e=>{
      e.preventDefault();img.setPointerCapture(e.pointerId);noteViewerState.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(noteViewerState.pointers.size===1){noteViewerState.startX=e.clientX;noteViewerState.startY=e.clientY;noteViewerState.originX=noteViewerState.x;noteViewerState.originY=noteViewerState.y;}
      if(noteViewerState.pointers.size===2){noteViewerState.startDistance=distance();noteViewerState.startScale=noteViewerState.scale;}
    });
    img.addEventListener('pointermove',e=>{
      if(!noteViewerState.pointers.has(e.pointerId))return;e.preventDefault();noteViewerState.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(noteViewerState.pointers.size===2){const mid=midpoint();setNoteScale(img,noteViewerState.startScale*(distance()/Math.max(1,noteViewerState.startDistance)),mid.x,mid.y);}
      else if(noteViewerState.pointers.size===1&&noteViewerState.scale>1){noteViewerState.x=noteViewerState.originX+(e.clientX-noteViewerState.startX);noteViewerState.y=noteViewerState.originY+(e.clientY-noteViewerState.startY);clampNotePosition(img);applyNoteTransform(img);}
    });
    const finish=e=>{noteViewerState.pointers.delete(e.pointerId);if(noteViewerState.pointers.size===1){const p=[...noteViewerState.pointers.values()][0];noteViewerState.startX=p.x;noteViewerState.startY=p.y;noteViewerState.originX=noteViewerState.x;noteViewerState.originY=noteViewerState.y;}clampNotePosition(img);applyNoteTransform(img);};
    img.addEventListener('pointerup',finish);img.addEventListener('pointercancel',finish);
    img.addEventListener('dblclick',e=>{e.preventDefault();setNoteScale(img,noteViewerState.scale>1?1:2,e.clientX-stage.getBoundingClientRect().left-stage.clientWidth/2,e.clientY-stage.getBoundingClientRect().top-stage.clientHeight/2);});
  }

  function openViewer(song,type){
    const label=type==='notes'?'Notas':type==='daniel'?'Daniel':'Letra';
    $('#viewerTitle').textContent=`${label} · ${song.titulo}`;
    const content=$('#viewerContent');content.innerHTML='';content.classList.remove('is-note-viewer');
    if(type==='notes'){
      const key=slug(song.titulo);let file=song.elenaNotesDataUrl||song.elenaNotes||song.notasElena||state.notes[key];
      if(Array.isArray(file)) file=file[0];
      if(file && typeof file==='object') file=file.archivo||file.file||file.ruta;
      if(file){
        const img=new Image();
        img.alt=`Notas de ${song.titulo}`;
        img.src=String(file).startsWith('data:')||String(file).startsWith('blob:')||String(file).startsWith('assets/')?file:`assets/anotaciones/${file}`;
        img.addEventListener('load',()=>installNoteGestures(img),{once:true});
        img.addEventListener('error',()=>{content.classList.remove('is-note-viewer');content.innerHTML='<div class="viewer-empty"><h3>No se pudo abrir la foto</h3><p>La anotación existe, pero el archivo no pudo cargarse.</p></div>';},{once:true});
        content.append(img);
      } else content.innerHTML='<div class="viewer-empty"><h3>Sin notas disponibles</h3><p>Esta canción todavía no tiene un JPEG asociado.</p></div>';
    } else {
      const isDaniel=type==='daniel';
      const html=isDaniel ? (song.cancioneroDaniel || song.danielLyrics || song.letraDaniel || '') : (song.elenaLyrics || song.cancioneroElena || song.letraElena || '');
      if(html){const page=document.createElement('article');page.className='live-songbook-page';page.innerHTML=html;content.append(page);}
      else content.innerHTML=`<div class="viewer-empty"><h3>Sin contenido disponible</h3><p>Esta canción todavía no tiene contenido en el Cancionero ${isDaniel?'Daniel':'Elena'}.</p></div>`;
    }
    $('#viewerDialog').showModal();
  }

  function askConfirm(title,text,onAccept,acceptLabel='Confirmar'){
    state.pendingConfirm=onAccept;$('#confirmTitle').textContent=title;$('#confirmText').textContent=text;$('#confirmAccept').textContent=acceptLabel;$('#confirmDialog').showModal();
  }
  $('#confirmAccept').addEventListener('click',()=>{const fn=state.pendingConfirm;state.pendingConfirm=null;$('#confirmDialog').close();fn?.();});
  $('#confirmCancel').addEventListener('click',()=>{$('#confirmDialog').close();state.pendingConfirm=null;});

  function dialogSnapshot(dialog){
    const fields=$$('input, select, textarea',dialog).map(el=>{
      if(el.type==='file') return `${el.id}:file:${el.files?.[0]?.name||''}`;
      if(el.type==='checkbox'||el.type==='radio') return `${el.id||el.name||el.value}:${el.checked}`;
      return `${el.id||el.name}:${el.value}`;
    });
    if(dialog.id==='newSongDialog') fields.push(`photo:${state.newSongElenaNotes?.dataUrl||''}`);
    if(dialog.id==='editSongDialog') fields.push(`photo:${state.editSongElenaNotes?.dataUrl||state.editSongElenaNotes?.src||''}`);
    if(dialog.id==='songbookEditorDialog'){ fields.push(`html:${$('#songbookEditor').innerHTML}`); fields.push(`drawing:${state.songbookDrawingData||''}`); }
    return JSON.stringify(fields);
  }
  function rememberDialogState(dialog){dialogBaselines.set(dialog,dialogSnapshot(dialog));}
  function dialogHasUnsavedChanges(dialog){
    if(!trackedDialogIds.has(dialog.id)) return false;
    return dialogBaselines.get(dialog)!==dialogSnapshot(dialog);
  }
  function closeDialogDirect(dialog){dialog.close();dialogBaselines.delete(dialog);}
  function requestDialogClose(dialog){
    if(!dialogHasUnsavedChanges(dialog)) return closeDialogDirect(dialog);
    askConfirm('Hay cambios sin guardar','¿Deseas salir sin guardar?',()=>closeDialogDirect(dialog),'Salir sin guardar');
  }
  $$('[data-dialog-close]').forEach(btn=>btn.addEventListener('click',()=>{
    const dialog=btn.closest('dialog');
    if(dialog.id==='confirmDialog'){dialog.close();state.pendingConfirm=null;return;}
    if(dialog.id==='viewerDialog'){askConfirm('Cerrar visor','¿Seguro que deseas cerrar las notas?',()=>closeDialogDirect(dialog),'Cerrar');return;}
    requestDialogClose(dialog);
  }));
  $$('dialog').forEach(d=>{
    d.addEventListener('click',e=>{if(e.target===d)e.preventDefault();});
    d.addEventListener('cancel',e=>{e.preventDefault();if(trackedDialogIds.has(d.id))requestDialogClose(d);});
  });
  $$('.menu-options button').forEach(btn=>btn.addEventListener('click',()=>{
    $('#toolsMenu').close();
    $('#openMenuBtn').setAttribute('aria-expanded','false');
    if(btn.dataset.module==='new-song') return openNewSong();
    if(btn.dataset.module==='repertoires') return openRepertoires();
    if(btn.dataset.module==='edit-songs') return openEditSongs();
    if(btn.dataset.module==='songbook-elena') return openSongbookList('elena');
    if(btn.dataset.module==='songbook-daniel') return openSongbookList('daniel');
    if(btn.dataset.module==='export-contacts') return openExportContacts();
    if(btn.dataset.module==='upload-photos') return openPhotoManager();
    if(btn.dataset.module==='security') return openSecurityAuth();
    $('#noticeTitle').textContent=btn.dataset.placeholder;
    $('#noticeDialog').showModal();
  }));
  $('#openMenuBtn').addEventListener('click',()=>{
    $('#toolsMenu').showModal();
    $('#openMenuBtn').setAttribute('aria-expanded','true');
  });
  $('#closeMenuBtn').addEventListener('click',()=>{
    $('#toolsMenu').close();
    $('#openMenuBtn').setAttribute('aria-expanded','false');
  });


  const defaultGenres=['Blues','Jazz','Rock','Pop','Reggae','Soul','Latino','Balada'];
  function allRepertoires(){
    const map=new Map([['todas','Todas las canciones']]);
    state.customRepertoires.forEach(r=>map.set(r.id,r.name));
    state.songs.forEach(song=>(song.listas||[]).forEach(id=>{if(!map.has(id))map.set(id,titleFromId(id));}));
    return [...map].map(([id,name])=>({id,name})).sort((a,b)=>{
      if(a.id==='todas') return 1;
      if(b.id==='todas') return -1;
      return a.name.localeCompare(b.name,'es');
    });
  }
  function openNewSong(){
    $('#newSongForm').reset();
    clearElenaNotesSelection();
    $('#newSongGenres').innerHTML=defaultGenres.map(g=>`<label class="check-item"><input type="checkbox" value="${esc(g)}">${esc(g)}</label>`).join('');
    $('#newSongRepertoires').innerHTML=allRepertoires().map(r=>`<label class="check-item"><input type="checkbox" value="${esc(r.id)}" ${r.id==='todas'?'checked disabled':''}>${esc(r.name)}</label>`).join('');
    $('#newSongDialog').showModal();
    rememberDialogState($('#newSongDialog'));
  }
  const elenaNotesInput=$('#newSongElenaNotes');
  $('#chooseElenaNotesBtn').addEventListener('click',()=>elenaNotesInput.click());
  $('#removeElenaNotesBtn').addEventListener('click',clearElenaNotesSelection);
  elenaNotesInput.addEventListener('change',async()=>{
    const file=elenaNotesInput.files?.[0];
    if(!file) return clearElenaNotesSelection();
    if(!isPhotoFile(file)){clearElenaNotesSelection();return toast('Selecciona un archivo de imagen');}
    $('#elenaNotesFileName').textContent=file.name;
    try{
      const dataUrl=await normalizePhoto(file);
      state.newSongElenaNotes={name:file.name,type:file.type||'image/*',dataUrl};
      $('#elenaNotesPreviewImage').src=dataUrl;
      $('#elenaNotesPreview').hidden=false;
      $('#removeElenaNotesBtn').hidden=false;
    }catch(err){
      console.error(err);clearElenaNotesSelection();toast('No se pudo leer la imagen');
    }
  });
  function isPhotoFile(file){
    return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif|gif|bmp|tiff?)$/i.test(file.name);
  }
  function clearElenaNotesSelection(){
    state.newSongElenaNotes=null;
    if(elenaNotesInput) elenaNotesInput.value='';
    $('#elenaNotesFileName').textContent='Ninguna foto seleccionada';
    $('#elenaNotesPreview').hidden=true;
    $('#elenaNotesPreviewImage').removeAttribute('src');
    $('#removeElenaNotesBtn').hidden=true;
  }
  function readAsDataURL(file){
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
  }
  async function normalizePhoto(file){
    const original=await readAsDataURL(file);
    return new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>{
        const max=1800,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        try{resolve(canvas.toDataURL('image/jpeg',.86));}catch(_){resolve(original);}
      };
      img.onerror=()=>resolve(original);
      img.src=original;
    });
  }

  $$('.lyric-input').forEach(field=>field.addEventListener('paste',e=>{
    e.preventDefault();
    const text=(e.clipboardData||window.clipboardData).getData('text/plain').replace(/\r\n?/g,'\n');
    const start=field.selectionStart,end=field.selectionEnd;
    field.setRangeText(text,start,end,'end');
    field.dispatchEvent(new Event('input',{bubbles:true}));
  }));

  $('#newSongForm').addEventListener('submit',e=>{
    e.preventDefault();
    const title=$('#newSongTitle').value.trim(),artist=$('#newSongArtist').value.trim();
    if(!title||!artist)return toast('Completa título y artista');
    const duplicate=state.songs.some(s=>norm(s.titulo)===norm(title)&&norm(s.artista)===norm(artist));
    if(duplicate)return toast('Esta canción ya existe');
    const genres=$$('#newSongGenres input:checked').map(x=>x.value);
    const lists=['todas',...$$('#newSongRepertoires input:checked:not([value="todas"])').map(x=>x.value)];
    const song={
      id:`custom-${Date.now()}`,
      titulo:title,
      artista:artist,
      idioma:$('#newSongLanguage').value,
      generos:genres,
      listas:[...new Set(lists)],
      letraPublica:$('#newSongPublicLyrics').value.trim(),
      cancioneroElena:$('#newSongElenaLyrics').value.trim(),
      notasElena:state.newSongElenaNotes,
      cancioneroDaniel:$('#newSongDanielLyrics').value.trim()
    };
    askConfirm('Guardar nueva canción',`Se añadirá “${title}” a la base de canciones.`,()=>{
      state.customSongs.push(song);state.songs.push(song);sortMasterSongs();state.customSongs.sort((a,b)=>a.numero-b.numero);try{saveState();}catch(err){state.customSongs=state.customSongs.filter(s=>s.id!==song.id);state.songs=state.songs.filter(s=>s.id!==song.id);sortMasterSongs();return toast('La foto es demasiado pesada para guardarla. Prueba una imagen más pequeña.');}buildRepertoires();dialogBaselines.delete($('#newSongDialog'));$('#newSongDialog').close();clearElenaNotesSelection();toast('Guardado exitosamente');
      if(state.config)filterSongs();
    },'Guardar');
  });
  function openEditSongs(){
    $('#editSongsSearch').value='';
    renderEditSongsList();
    $('#editSongsDialog').showModal();
  }
  $('#editSongsSearch').addEventListener('input',renderEditSongsList);
  function renderEditSongsList(){
    const q=norm($('#editSongsSearch').value), list=$('#editSongsList');
    const songs=state.songs.filter(song=>!q||norm(song.titulo).includes(q)||norm(song.artista).includes(q));
    $('#editSongsCount').textContent=`${songs.length} canciones`;
    list.innerHTML='';
    songs.forEach(song=>{
      const row=document.createElement('div');row.className='edit-song-row';
      row.innerHTML=`<span class="edit-song-number">${String(song.numero||'').padStart(2,'0')}</span><div><strong>${esc(song.titulo)}</strong><small>${esc(song.artista||'Artista no indicado')}</small></div><button type="button" class="secondary-btn">Editar</button>`;
      row.querySelector('button').addEventListener('click',()=>openEditSong(song.id));
      list.append(row);
    });
    if(!songs.length) list.innerHTML='<div class="viewer-empty"><h3>No se encontraron canciones</h3></div>';
  }
  function openEditSong(id){
    const song=state.songs.find(s=>s.id===id);if(!song)return;
    $('#editSongId').value=id;$('#editSongTitle').value=song.titulo||'';$('#editSongArtist').value=song.artista||'';
    $('#editSongLanguage').value=song.idioma||'Español';
    const songGenres=Array.isArray(song.generos)?song.generos:[];
    const genres=[...new Set([...defaultGenres,...songGenres])];
    const selectedGenres=new Set(songGenres.map(norm));
    $('#editSongGenres').innerHTML=genres.map(g=>`<label class="check-item"><input type="checkbox" value="${esc(g)}" ${selectedGenres.has(norm(g))?'checked':''}>${esc(g)}</label>`).join('');
    const rawLists=Array.isArray(song.listas)?song.listas:[];
    const selectedLists=new Set(rawLists.map(norm));
    $('#editSongRepertoires').innerHTML=allRepertoires().map(r=>{
      const assigned=r.id==='todas'||selectedLists.has(norm(r.id))||selectedLists.has(norm(r.name));
      return `<label class="check-item"><input type="checkbox" value="${esc(r.id)}" ${assigned?'checked':''} ${r.id==='todas'?'disabled':''}>${esc(r.name)}</label>`;
    }).join('');
    $('#editSongPublicLyrics').value=song.letraPublica||'';$('#editSongElenaLyrics').value=song.cancioneroElena||'';$('#editSongDanielLyrics').value=song.cancioneroDaniel||'';
    state.editSongElenaNotes=song.notasElena ? structuredClone(song.notasElena) : null;
    refreshEditNotesPreview(song);
    $('#editSongDialog').showModal();rememberDialogState($('#editSongDialog'));
  }
  const editNotesInput=$('#editSongElenaNotes');
  $('#chooseEditElenaNotesBtn').addEventListener('click',()=>editNotesInput.click());
  $('#removeEditElenaNotesBtn').addEventListener('click',()=>{state.editSongElenaNotes=null;editNotesInput.value='';refreshEditNotesPreview();});
  editNotesInput.addEventListener('change',async()=>{
    const file=editNotesInput.files?.[0];if(!file)return;
    if(!isPhotoFile(file)){editNotesInput.value='';return toast('Selecciona un archivo de imagen');}
    try{state.editSongElenaNotes={name:file.name,type:file.type||'image/*',dataUrl:await normalizePhoto(file)};refreshEditNotesPreview();}
    catch(err){console.error(err);toast('No se pudo leer la imagen');}
  });
  function refreshEditNotesPreview(song){
    const note=state.editSongElenaNotes;let src=note?.dataUrl||note?.src||'';
    if(!src && song){const key=slug(song.titulo);let file=state.notes[key];if(Array.isArray(file))file=file[0];if(file)src=`assets/anotaciones/${file}`;}
    $('#editElenaNotesFileName').textContent=note?.name|| (src?'Imagen actual':'Sin imagen');
    $('#removeEditElenaNotesBtn').hidden=!src;
    $('#editElenaNotesPreview').hidden=!src;
    if(src)$('#editElenaNotesPreviewImage').src=src;else $('#editElenaNotesPreviewImage').removeAttribute('src');
  }
  $('#editSongForm').addEventListener('submit',e=>{
    e.preventDefault();const id=$('#editSongId').value,song=state.songs.find(s=>s.id===id);if(!song)return;
    const title=$('#editSongTitle').value.trim(),artist=$('#editSongArtist').value.trim();if(!title||!artist)return toast('Completa título y artista');
    const duplicate=state.songs.some(s=>s.id!==id&&norm(s.titulo)===norm(title)&&norm(s.artista)===norm(artist));if(duplicate)return toast('Esta canción ya existe');
    const updated={...song,titulo:title,artista:artist,idioma:$('#editSongLanguage').value,generos:$$('#editSongGenres input:checked').map(x=>x.value),listas:[...new Set(['todas',...$$('#editSongRepertoires input:checked:not([value="todas"])').map(x=>x.value)])],letraPublica:$('#editSongPublicLyrics').value.trim(),cancioneroElena:$('#editSongElenaLyrics').value.trim(),notasElena:state.editSongElenaNotes,cancioneroDaniel:$('#editSongDanielLyrics').value.trim()};
    askConfirm('Guardar cambios',`Se actualizará “${title}”.`,()=>{
      const index=state.songs.findIndex(s=>s.id===id);state.songs[index]=updated;
      const customIndex=state.customSongs.findIndex(s=>s.id===id);
      if(customIndex>=0)state.customSongs[customIndex]=updated;else state.songEdits[id]={...updated};
      sortMasterSongs();
      try{saveState();}catch(err){return toast('La imagen es demasiado pesada para guardarla. Prueba una imagen más pequeña.');}
      buildRepertoires();dialogBaselines.delete($('#editSongDialog'));$('#editSongDialog').close();renderEditSongsList();if(state.config)filterSongs();toast('Guardado exitosamente');
    },'Guardar');
  });


  let activeSongbookOwner='elena';
  let activeSongbookSongId=null;
  state.songbookDrawingData='';
  let songbookDrawingEnabled=false;
  let drawingCtx=null, drawingSnapshot=null, drawingActive=false, drawingPath=[];
  let editorUndoStack=[], editorRedoStack=[], wordHistoryTimer=null, restoringEditorHistory=false;
  let savedEditorRange=null, currentTextColor='#d00000', currentFontSize='30', currentBold=true, currentItalic=false, currentDrawColor='#d00000';
  let drawHoldTimer=null, drawHoldTriggered=false;

  function songbookField(owner){ return owner==='elena'?'cancioneroElena':'cancioneroDaniel'; }
  function songbookDrawingField(owner){ return owner==='elena'?'cancioneroElenaDibujo':'cancioneroDanielDibujo'; }
  function ownerLabel(owner){ return owner==='elena'?'Elena':'Daniel'; }

  function openSongbookList(owner){
    activeSongbookOwner=owner;$('#songbookListTitle').textContent=`Cancionero ${ownerLabel(owner)}`;$('#songbookSearch').value='';renderSongbookList();$('#songbookListDialog').showModal();
  }
  function renderSongbookList(){
    const q=norm($('#songbookSearch').value),field=songbookField(activeSongbookOwner),songs=state.songs.filter(song=>!q||norm(song.titulo).includes(q)||norm(song.artista).includes(q));
    $('#songbookCount').textContent=`${songs.length} canciones`;const list=$('#songbookSongsList');list.innerHTML='';
    songs.forEach(song=>{const row=document.createElement('div');row.className='edit-song-row';const hasText=Boolean(String(song[field]||'').trim());row.innerHTML=`<span class="edit-song-number">${String(song.numero||'').padStart(2,'0')}</span><div><strong>${esc(song.titulo)}</strong><small>${esc(song.artista||'Artista no indicado')} · ${hasText?'Con texto':'Vacío'}</small></div><button type="button" class="secondary-btn">Editar</button>`;row.querySelector('button').addEventListener('click',()=>openSongbookEditor(song.id));list.append(row);});
    if(!songs.length)list.innerHTML='<div class="viewer-empty"><h3>No se encontraron canciones</h3></div>';
  }
  $('#songbookSearch').addEventListener('input',renderSongbookList);
  function cleanPastedText(html,text){const raw=text||new DOMParser().parseFromString(html||'','text/html').body.innerText||'';return raw.replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim();}

  function fullEditorSnapshot(){return{html:$('#songbookEditor').innerHTML,drawing:state.songbookDrawingData||''};}
  function sameSnapshot(a,b){return a&&b&&a.html===b.html&&a.drawing===b.drawing;}
  function resetEditorHistory(){editorUndoStack=[fullEditorSnapshot()];editorRedoStack=[];updateEditorHistoryButtons();}
  function updateEditorHistoryButtons(){$('#songbookUndo').disabled=editorUndoStack.length<=1;$('#songbookRedo').disabled=!editorRedoStack.length;}
  function commitEditorHistory(){if(restoringEditorHistory)return;clearTimeout(wordHistoryTimer);const snap=fullEditorSnapshot();if(!sameSnapshot(editorUndoStack.at(-1),snap)){editorUndoStack.push(snap);if(editorUndoStack.length>120)editorUndoStack.shift();editorRedoStack=[];}updateEditorHistoryButtons();}
  function scheduleWordHistory(){clearTimeout(wordHistoryTimer);wordHistoryTimer=setTimeout(commitEditorHistory,500);}
  function restoreEditorState(snap){restoringEditorHistory=true;$('#songbookEditor').innerHTML=snap.html;state.songbookDrawingData=snap.drawing||'';loadSongbookDrawing(state.songbookDrawingData);restoringEditorHistory=false;updateEditorHistoryButtons();}
  function undoEditor(){commitEditorHistory();if(editorUndoStack.length<=1)return;editorRedoStack.push(editorUndoStack.pop());restoreEditorState(editorUndoStack.at(-1));}
  function redoEditor(){if(!editorRedoStack.length)return;const next=editorRedoStack.pop();editorUndoStack.push(next);restoreEditorState(next);}

  function openSongbookEditor(id){
    const song=state.songs.find(s=>s.id===id);if(!song)return;activeSongbookSongId=id;const field=songbookField(activeSongbookOwner);
    $('#songbookEditorOwner').textContent=`CANCIONERO ${ownerLabel(activeSongbookOwner).toUpperCase()}`;$('#songbookEditorTitle').textContent=`${song.titulo} · ${song.artista||''}`;
    const editor=$('#songbookEditor'),saved=String(song[field]||'');editor.innerHTML=saved.includes('<')?saved:esc(saved).replace(/\n/g,'<br>');
    currentTextColor='#d00000';currentFontSize='30';currentBold=true;currentItalic=false;$('#songbookFontSize').value='30';updateColorButton();updateFormatButtons();
    state.songbookDrawingData=String(song[songbookDrawingField(activeSongbookOwner)]||'');songbookDrawingEnabled=false;$('#songbookDrawToggle').classList.remove('is-active');$('#songbookDrawingCanvas').classList.remove('is-active');editor.contentEditable='true';
    $('#songbookEditorDialog').showModal();requestAnimationFrame(()=>{resizeSongbookCanvas();loadSongbookDrawing(state.songbookDrawingData);rememberDialogState($('#songbookEditorDialog'));resetEditorHistory();});setTimeout(()=>{placeCaretAtEnd(editor);applyTypingFormat();saveEditorSelection();},80);
  }
  function placeCaretAtEnd(el){const range=document.createRange(),sel=window.getSelection();range.selectNodeContents(el);range.collapse(false);sel.removeAllRanges();sel.addRange(range);el.focus();}
  function selectionInsideEditor(){const sel=window.getSelection();return sel&&sel.rangeCount&&$('#songbookEditor').contains(sel.anchorNode);}
  function saveEditorSelection(){if(selectionInsideEditor())savedEditorRange=window.getSelection().getRangeAt(0).cloneRange();}
  function restoreEditorSelection(){const editor=$('#songbookEditor');editor.focus();if(savedEditorRange){const sel=window.getSelection();sel.removeAllRanges();sel.addRange(savedEditorRange);}}
  document.addEventListener('selectionchange',()=>{if($('#songbookEditorDialog').open&&selectionInsideEditor()){saveEditorSelection();updateFormatButtonsFromSelection();}});
  function applyTypingFormat(){restoreEditorSelection();document.execCommand('styleWithCSS',false,true);document.execCommand('foreColor',false,currentTextColor);const bold=document.queryCommandState('bold');if(bold!==currentBold)document.execCommand('bold');const italic=document.queryCommandState('italic');if(italic!==currentItalic)document.execCommand('italic');saveEditorSelection();applyFontSize(currentFontSize);}
  function updateColorButton(){$('#songbookColorSwatch').style.background=currentTextColor;$$('[data-text-color]').forEach(b=>b.classList.toggle('is-active',b.dataset.textColor===currentTextColor));}
  function updateFormatButtons(){$('#songbookBold').classList.toggle('is-active',currentBold);$('#songbookItalic').classList.toggle('is-active',currentItalic);}
  function updateFormatButtonsFromSelection(){currentBold=document.queryCommandState('bold');currentItalic=document.queryCommandState('italic');updateFormatButtons();}
  function positionPopover(pop,anchor){const r=anchor.getBoundingClientRect();pop.hidden=false;const w=pop.offsetWidth;let left=Math.min(Math.max(6,r.left),window.innerWidth-w-6);let top=r.bottom+5;if(top+pop.offsetHeight>window.innerHeight-6)top=Math.max(6,r.top-pop.offsetHeight-5);pop.style.left=`${left}px`;pop.style.top=`${top}px`;}
  function closeToolbarPopovers(except){[$('#songbookColorMenu'),$('#songbookDrawOptions')].forEach(p=>{if(p!==except)p.hidden=true;});}

  function resizeSongbookCanvas(){const canvas=$('#songbookDrawingCanvas'),stage=$('#songbookPaperStage');if(!canvas||!stage)return;const ratio=Math.max(1,window.devicePixelRatio||1),w=Math.max(1,stage.scrollWidth),h=Math.max(1,stage.scrollHeight),old=state.songbookDrawingData;canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;drawingCtx=canvas.getContext('2d');drawingCtx.setTransform(ratio,0,0,ratio,0,0);drawingCtx.lineCap='round';drawingCtx.lineJoin='round';if(old)loadSongbookDrawing(old);}
  function loadSongbookDrawing(data){const canvas=$('#songbookDrawingCanvas');if(!drawingCtx||!canvas)return;drawingCtx.clearRect(0,0,parseFloat(canvas.style.width)||canvas.width,parseFloat(canvas.style.height)||canvas.height);if(!data)return;const img=new Image();img.onload=()=>drawingCtx.drawImage(img,0,0,parseFloat(canvas.style.width),parseFloat(canvas.style.height));img.src=data;}
  function saveDrawingData(){state.songbookDrawingData=$('#songbookDrawingCanvas').toDataURL('image/png');}
  function canvasPoint(e){const r=$('#songbookDrawingCanvas').getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  function drawArrowHead(ctx,from,to){
    const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);
    if(distance<0.5)return;
    const ux=dx/distance,uy=dy/distance,width=Number($('#songbookDrawWidth').value||5);
    const headLength=14+width,headHalfWidth=Math.max(6,headLength*.48);
    // La punta se prolonga fuera del último punto, en la dirección real del trazo.
    const tip={x:to.x+ux*headLength*.55,y:to.y+uy*headLength*.55};
    const base={x:tip.x-ux*headLength,y:tip.y-uy*headLength};
    const px=-uy,py=ux;
    ctx.beginPath();
    ctx.moveTo(base.x+px*headHalfWidth,base.y+py*headHalfWidth);
    ctx.lineTo(tip.x,tip.y);
    ctx.lineTo(base.x-px*headHalfWidth,base.y-py*headHalfWidth);
    ctx.stroke();
  }
  function drawPath(points,mode){if(points.length<2)return;drawingCtx.beginPath();drawingCtx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)drawingCtx.lineTo(points[i].x,points[i].y);drawingCtx.stroke();if(mode==='arrow'||mode==='double-arrow')drawArrowHead(drawingCtx,points.at(-2),points.at(-1));if(mode==='double-arrow')drawArrowHead(drawingCtx,points[1],points[0]);}
  function toggleDrawing(force){songbookDrawingEnabled=force??!songbookDrawingEnabled;$('#songbookDrawToggle').classList.toggle('is-active',songbookDrawingEnabled);$('#songbookDrawingCanvas').classList.toggle('is-active',songbookDrawingEnabled);$('#songbookEditor').contentEditable=String(!songbookDrawingEnabled);if(songbookDrawingEnabled)resizeSongbookCanvas();}
  function updateDrawColorUI(){
    const input=$('#songbookDrawColor');
    if(input)input.value=currentDrawColor;
    const toggle=$('#songbookDrawToggle');
    if(toggle){
      toggle.style.setProperty('--active-draw-color',currentDrawColor);
      toggle.style.setProperty('--active-draw-text-color',['#111111','#1565c0','#16833b','#d00000'].includes(currentDrawColor)?'#fff':'#111');
    }
    $$('[data-draw-color]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.drawColor===currentDrawColor));
  }

  $('#songbookColorBtn').addEventListener('click',e=>{e.stopPropagation();const pop=$('#songbookColorMenu');if(!pop.hidden){pop.hidden=true;return;}closeToolbarPopovers(pop);positionPopover(pop,e.currentTarget);});
  $$('[data-text-color]').forEach(btn=>btn.addEventListener('click',()=>{currentTextColor=btn.dataset.textColor;updateColorButton();restoreEditorSelection();document.execCommand('styleWithCSS',false,true);document.execCommand('foreColor',false,currentTextColor);saveEditorSelection();commitEditorHistory();$('#songbookColorMenu').hidden=true;}));
  $('.songbook-toolbar').addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault();});
  $$('[data-editor-command]').forEach(btn=>btn.addEventListener('click',()=>{restoreEditorSelection();document.execCommand(btn.dataset.editorCommand,false,null);currentBold=document.queryCommandState('bold');currentItalic=document.queryCommandState('italic');updateFormatButtons();saveEditorSelection();commitEditorHistory();}));
  function applyFontSize(size){
    currentFontSize=String(size);
    restoreEditorSelection();
    const editor=$('#songbookEditor'),sel=window.getSelection();
    if(!sel||!sel.rangeCount||!editor.contains(sel.anchorNode))return;
    const range=sel.getRangeAt(0);
    if(!range.collapsed){
      const span=document.createElement('span');span.style.fontSize=`${currentFontSize}px`;
      try{span.append(range.extractContents());range.insertNode(span);range.selectNodeContents(span);sel.removeAllRanges();sel.addRange(range);}catch{document.execCommand('fontSize',false,'7');}
    }else{
      const span=document.createElement('span');
      span.style.fontSize=`${currentFontSize}px`;span.style.color=currentTextColor;
      span.style.fontWeight=currentBold?'700':'400';span.style.fontStyle=currentItalic?'italic':'normal';
      const marker=document.createTextNode('\u200B');span.append(marker);range.insertNode(span);
      range.setStart(marker,1);range.collapse(true);sel.removeAllRanges();sel.addRange(range);
    }
    saveEditorSelection();commitEditorHistory();
  }
  $('#songbookFontSize').addEventListener('pointerdown',saveEditorSelection);
  $('#songbookFontSize').addEventListener('mousedown',saveEditorSelection);
  $('#songbookFontSize').addEventListener('change',e=>applyFontSize(e.target.value));
  $('#songbookUndo').addEventListener('click',undoEditor);$('#songbookRedo').addEventListener('click',redoEditor);

  $('#songbookDrawToggle').addEventListener('pointerdown',e=>{e.preventDefault();drawHoldTriggered=false;drawHoldTimer=setTimeout(()=>{drawHoldTriggered=true;closeToolbarPopovers($('#songbookDrawOptions'));positionPopover($('#songbookDrawOptions'),$('#songbookDrawToggle'));},480);});
  function finishDrawButtonPress(){clearTimeout(drawHoldTimer);if(!drawHoldTriggered)toggleDrawing();}
  $('#songbookDrawToggle').addEventListener('pointerup',finishDrawButtonPress);$('#songbookDrawToggle').addEventListener('pointercancel',()=>clearTimeout(drawHoldTimer));$('#songbookDrawToggle').addEventListener('contextmenu',e=>e.preventDefault());
  $$('[data-draw-color]').forEach(btn=>btn.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    currentDrawColor=btn.dataset.drawColor;
    updateDrawColorUI();
  }));
  $('#songbookClearDrawing').addEventListener('click',()=>askConfirm('Borrar dibujo','Se eliminarán todos los trazos de esta canción.',()=>{drawingCtx.clearRect(0,0,parseFloat($('#songbookDrawingCanvas').style.width),parseFloat($('#songbookDrawingCanvas').style.height));state.songbookDrawingData='';commitEditorHistory();},'Borrar'));
  updateDrawColorUI();
  $('#songbookDrawingCanvas').addEventListener('pointerdown',e=>{if(!songbookDrawingEnabled)return;e.preventDefault();drawingActive=true;drawingPath=[canvasPoint(e)];drawingSnapshot=drawingCtx.getImageData(0,0,$('#songbookDrawingCanvas').width,$('#songbookDrawingCanvas').height);drawingCtx.strokeStyle=$('#songbookDrawColor').value;drawingCtx.lineWidth=Number($('#songbookDrawWidth').value);e.currentTarget.setPointerCapture(e.pointerId);});
  $('#songbookDrawingCanvas').addEventListener('pointermove',e=>{if(!drawingActive)return;e.preventDefault();drawingPath.push(canvasPoint(e));drawingCtx.putImageData(drawingSnapshot,0,0);drawingCtx.strokeStyle=$('#songbookDrawColor').value;drawingCtx.lineWidth=Number($('#songbookDrawWidth').value);drawPath(drawingPath,$('#songbookDrawMode').value);});
  function finishDrawing(e){if(!drawingActive)return;drawingActive=false;saveDrawingData();commitEditorHistory();try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}}
  $('#songbookDrawingCanvas').addEventListener('pointerup',finishDrawing);$('#songbookDrawingCanvas').addEventListener('pointercancel',finishDrawing);
  window.addEventListener('resize',()=>{closeToolbarPopovers();if($('#songbookEditorDialog').open)resizeSongbookCanvas();});
  document.addEventListener('click',e=>{if(!e.target.closest('.toolbar-popover-wrap')&&!e.target.closest('.compact-popover'))closeToolbarPopovers();});

  $('#songbookEditor').addEventListener('paste',e=>{e.preventDefault();restoreEditorSelection();const text=cleanPastedText(e.clipboardData.getData('text/html'),e.clipboardData.getData('text/plain'));document.execCommand('insertText',false,text);applyTypingFormat();commitEditorHistory();});
  $('#songbookEditor').addEventListener('beforeinput',e=>{if(e.inputType==='insertText'&&/[\s.,;:!?]/.test(e.data||''))commitEditorHistory();});
  $('#songbookEditor').addEventListener('input',()=>{saveEditorSelection();scheduleWordHistory();});
  $('#songbookEditor').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redoEditor():undoEditor();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redoEditor();}});

  $('#saveSongbookBtn').addEventListener('click',()=>{commitEditorHistory();const song=state.songs.find(s=>s.id===activeSongbookSongId);if(!song)return;const field=songbookField(activeSongbookOwner),html=$('#songbookEditor').innerHTML.trim();askConfirm('Guardar cancionero',`Se actualizará “${song.titulo}”.`,()=>{song[field]=html;song[songbookDrawingField(activeSongbookOwner)]=state.songbookDrawingData||'';const ci=state.customSongs.findIndex(s=>s.id===song.id);if(ci>=0)state.customSongs[ci]={...song};else state.songEdits[song.id]={...song};saveState();dialogBaselines.delete($('#songbookEditorDialog'));$('#songbookEditorDialog').close();renderSongbookList();toast('Guardado exitosamente');},'Guardar');});

  let activeRepertoireId = null;

  function openRepertoires(){
    const reps=allRepertoires();
    activeRepertoireId = reps.find(r=>r.id!=='todas')?.id || 'todas';
    $('#newRepertoireName').value='';
    $('#repertoireSongSearch').value='';
    renderRepertoireManager();
    $('#repertoiresDialog').showModal();
    rememberDialogState($('#repertoiresDialog'));
  }

  function repertoireSongIds(repId){
    if(repId==='todas') return new Set(state.songs.map(song=>song.id));
    return new Set(state.songs.filter(song=>(song.listas||[]).includes(repId)).map(song=>song.id));
  }

  function renderRepertoireManager(){
    const reps=allRepertoires();
    if(!reps.some(r=>r.id===activeRepertoireId)) activeRepertoireId=reps[0]?.id||'todas';
    $('#repertoireTotalCount').textContent=`${reps.length}`;
    const box=$('#repertoireManagerList');box.innerHTML='';
    reps.forEach(rep=>{
      const count=rep.id==='todas'?state.songs.length:state.songs.filter(song=>(song.listas||[]).includes(rep.id)).length;
      const button=document.createElement('button');
      button.type='button';
      button.className=`repertoire-select${rep.id===activeRepertoireId?' is-active':''}${rep.id==='todas'?' protected-repertoire':''}`;
      button.innerHTML=`<span><strong>${esc(rep.name)}</strong><small>${count} ${count===1?'canción':'canciones'}</small></span><b>›</b>`;
      button.addEventListener('click',()=>{
        if(dialogHasUnsavedChanges($('#repertoiresDialog'))){
          askConfirm('Cambios sin guardar','Se perderán los cambios del repertorio actual.',()=>{activeRepertoireId=rep.id;renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));},'Continuar');
        }else{activeRepertoireId=rep.id;renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));}
      });
      box.append(button);
    });
    renderSelectedRepertoire();
  }

  function renderSelectedRepertoire(){
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);
    const editor=$('#repertoireEditor');
    if(!rep){editor.hidden=true;return;}
    editor.hidden=false;
    const protectedRep=rep.id==='todas';
    const nameInput=$('#selectedRepertoireName');
    nameInput.value=rep.name;nameInput.disabled=protectedRep;
    $('#deleteSelectedRepertoireBtn').hidden=protectedRep;
    $('#duplicateSelectedRepertoireBtn').hidden=false;
    $('#saveRepertoireBtn').hidden=protectedRep;
    $('.repertoire-selection-help').textContent=protectedRep?'Lista maestra automática: incluye todas las canciones.':'Marca para agregar. Desmarca para quitar del repertorio.';
    renderRepertoireSongs();
  }

  function renderRepertoireSongs(){
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep)return;
    const selected=repertoireSongIds(rep.id), q=norm($('#repertoireSongSearch').value);
    const songs=state.songs.filter(song=>!q||norm(song.titulo).includes(q)||norm(song.artista).includes(q));
    $('#selectedRepertoireCount').textContent=selected.size;
    $('#repertoireSongsVisibleCount').textContent=`${songs.length} visibles`;
    const list=$('#repertoireSongsList');list.innerHTML='';
    songs.forEach(song=>{
      const label=document.createElement('label');label.className='repertoire-song-item';
      label.innerHTML=`<input type="checkbox" value="${esc(song.id)}" ${selected.has(song.id)?'checked':''} ${rep.id==='todas'?'disabled':''}><span class="repertoire-song-copy"><strong>${esc(song.titulo)}</strong><small>${esc(song.artista||'Artista no indicado')}</small></span><em>${String(song.numero||'').padStart(2,'0')}</em>`;
      label.querySelector('input').addEventListener('change',()=>{
        const count=$$('#repertoireSongsList input:checked').length;
        $('#selectedRepertoireCount').textContent=count;
      });
      list.append(label);
    });
    if(!songs.length)list.innerHTML='<div class="viewer-empty"><h3>No se encontraron canciones</h3><p>Prueba con otro título o artista.</p></div>';
  }

  $('#repertoireSongSearch').addEventListener('input',renderRepertoireSongs);

  $('#addRepertoireBtn').addEventListener('click',()=>{
    const name=$('#newRepertoireName').value.trim();if(!name)return toast('Escribe un nombre');
    if(allRepertoires().some(r=>norm(r.name)===norm(name)))return toast('Ese repertorio ya existe');
    const id=`rep-${slug(name)}-${Date.now().toString().slice(-5)}`;
    state.customRepertoires.push({id,name});
    activeRepertoireId=id;$('#newRepertoireName').value='';
    saveState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));toast('Guardado exitosamente');
  });

  $('#saveRepertoireBtn').addEventListener('click',()=>{
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep||rep.id==='todas')return;
    const name=$('#selectedRepertoireName').value.trim();if(!name)return toast('Escribe un nombre');
    if(allRepertoires().some(r=>r.id!==rep.id&&norm(r.name)===norm(name)))return toast('Ese repertorio ya existe');
    const checked=new Set($$('#repertoireSongsList input:checked').map(x=>x.value));
    askConfirm('Guardar repertorio',`Se actualizará “${name}” con ${checked.size} canciones.`,()=>{
      let item=state.customRepertoires.find(r=>r.id===rep.id);
      if(!item){item={id:rep.id,name:rep.name};state.customRepertoires.push(item);}
      item.name=name;
      state.songs.forEach(song=>{
        const listas=new Set(song.listas||[]);listas.add('todas');
        checked.has(song.id)?listas.add(rep.id):listas.delete(rep.id);
        song.listas=[...listas];
        const ci=state.customSongs.findIndex(s=>s.id===song.id);
        if(ci>=0)state.customSongs[ci]={...song};else state.songEdits[song.id]={...song};
      });
      if(state.config?.repertoire===rep.id)state.config.repertoireName=name;
      saveState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));if(state.config)filterSongs();toast('Guardado exitosamente');
    },'Guardar');
  });


  $('#duplicateSelectedRepertoireBtn').addEventListener('click',()=>{
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep)return;
    const sourceIds=repertoireSongIds(rep.id);
    const baseName=`Copia de ${rep.name}`;
    let name=baseName, n=2;
    while(allRepertoires().some(r=>norm(r.name)===norm(name))) name=`${baseName} ${n++}`;
    askConfirm('Duplicar repertorio',`Se creará “${name}” con ${sourceIds.size} canciones.`,()=>{
      const id=`rep-${slug(name)}-${Date.now().toString().slice(-5)}`;
      state.customRepertoires.push({id,name});
      state.songs.forEach(song=>{
        const listas=new Set(song.listas||[]);listas.add('todas');
        if(sourceIds.has(song.id))listas.add(id);
        song.listas=[...listas];
        const ci=state.customSongs.findIndex(s=>s.id===song.id);
        if(ci>=0)state.customSongs[ci]={...song};else state.songEdits[song.id]={...song};
      });
      activeRepertoireId=id;
      saveState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));toast('Guardado exitosamente');
    },'Duplicar');
  });

  $('#deleteSelectedRepertoireBtn').addEventListener('click',()=>{
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep||rep.id==='todas')return;
    askConfirm('Eliminar repertorio',`Se quitará “${rep.name}” de todas las canciones. Las canciones no serán eliminadas.`,()=>{
      state.customRepertoires=state.customRepertoires.filter(r=>r.id!==rep.id);
      state.songs.forEach(song=>{song.listas=[...new Set(['todas',...(song.listas||[]).filter(id=>id!==rep.id&&id!=='todas')])];const ci=state.customSongs.findIndex(s=>s.id===song.id);if(ci>=0)state.customSongs[ci]={...song};else state.songEdits[song.id]={...song};});
      if(state.config?.repertoire===rep.id){state.config.repertoire='todas';state.config.repertoireName='Todas las canciones';}
      activeRepertoireId=allRepertoires().find(r=>r.id!=='todas')?.id||'todas';
      saveState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));toast('Guardado exitosamente');
    },'Eliminar');
  });

  function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2800);}
  function norm(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
  function slug(v=''){return norm(v).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
  function esc(v=''){return String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}


  // Entrega 6.16 — Exportar contactos
  const DANIEL_PHONE='593992890540';
  function readContacts(){
    const candidates=['egm-contactos','contactos','egm-panel-v3-contactos']; let list=[];
    for(const key of candidates){try{const value=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(value))list.push(...value);}catch(_){} }
    try{const saved=JSON.parse(localStorage.getItem('egm-panel-v3')||'{}');if(Array.isArray(saved.contacts))list.push(...saved.contacts);if(Array.isArray(saved.contactos))list.push(...saved.contactos);}catch(_){}
    return list.map((x,i)=>({id:x.id||i,nombre:x.nombre||x.name||'Sin nombre',telefono:String(x.telefono||x.phone||'').replace(/\D/g,''),fecha:x.fecha||x.date||x.creado_en||x.createdAt||'',hora:x.hora||x.time||'',cancion:x.cancion||x.song||'',lugar:x.lugar||x.venue||'',perfil:x.perfil||x.perfil_clientes||x.profile||'',show:x.show||x.show_id||''})).filter(x=>x.telefono);
  }
  function uniqueContacts(list){const m=new Map();list.forEach(x=>{if(!m.has(x.telefono))m.set(x.telefono,x)});return [...m.values()];}
  function openExportContacts(){
    const contacts=readContacts(); const shows=[...new Set(contacts.map(x=>x.show).filter(Boolean))]; const venues=[...new Set(contacts.map(x=>x.lugar).filter(Boolean))];
    $('#exportShow').innerHTML='<option value="all">Todos</option>'+shows.map(x=>`<option>${esc(x)}</option>`).join('');
    $('#exportVenue').innerHTML='<option value="all">Todos</option>'+venues.map(x=>`<option>${esc(x)}</option>`).join('');
    $('#exportContactsDialog').showModal(); updateExportCount();
  }
  function filteredContacts(){let list=readContacts();const sh=$('#exportShow').value,v=$('#exportVenue').value,p=$('#exportProfile').value,fr=$('#exportDateFrom').value,to=$('#exportDateTo').value;list=list.filter(x=>(sh==='all'||x.show===sh)&&(v==='all'||x.lugar===v)&&(p==='all'||x.perfil===p));if(fr)list=list.filter(x=>String(x.fecha).slice(0,10)>=fr);if(to)list=list.filter(x=>String(x.fecha).slice(0,10)<=to);return uniqueContacts(list);}
  function updateExportCount(){$('#exportCount').textContent=filteredContacts().length;}
  ['exportContent','exportFormat','exportShow','exportVenue','exportProfile','exportDateFrom','exportDateTo'].forEach(id=>$('#'+id).addEventListener('change',updateExportCount));
  function contactRows(){const only=$('#exportContent').value==='phones';const rows=filteredContacts();return {only,rows};}
  function exportText(){const {only,rows}=contactRows();return only?rows.map(x=>'+'+x.telefono).join('\n'):['nombre\tteléfono\tfecha\thora\tcanción\tlugar\tperfil\tshow',...rows.map(x=>[x.nombre,'+'+x.telefono,x.fecha,x.hora,x.cancion,x.lugar,x.perfil,x.show].join('\t'))].join('\n');}
  function downloadContacts(){const {only,rows}=contactRows();if(!rows.length)return toast('No hay contactos para exportar');askConfirm('Exportar contactos',`Se exportarán ${rows.length} contactos únicos.`,()=>{let blob,name;if($('#exportFormat').value==='text'){blob=new Blob([exportText()],{type:'text/plain;charset=utf-8'});name='contactos.txt';}else{const heads=only?['Teléfono']:['Nombre','Teléfono','Fecha','Hora','Canción','Lugar','Perfil','Show'];const body=rows.map(x=>only?['+'+x.telefono]:[x.nombre,'+'+x.telefono,x.fecha,x.hora,x.cancion,x.lugar,x.perfil,x.show]);const html='<table><tr>'+heads.map(x=>`<th>${esc(x)}</th>`).join('')+'</tr>'+body.map(r=>'<tr>'+r.map(x=>`<td>${esc(x)}</td>`).join('')+'</tr>').join('')+'</table>';blob=new Blob(['\ufeff'+html],{type:'application/vnd.ms-excel'});name='contactos.xls';}const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);toast('Exportado exitosamente.');},'Exportar');}
  function securitySettings(){try{return {...{password:'2907',danielPhone:'593992890540',elenaPhone:'593987388915'},...JSON.parse(localStorage.getItem('egm-security-settings')||'{}')}}catch(_){return {password:'2907',danielPhone:'593992890540',elenaPhone:'593987388915'}}}
  function whatsappNumberElena(){return String(securitySettings().elenaPhone||'593987388915').replace(/\D/g,'');}
  function whatsappNumberDaniel(){return String(securitySettings().danielPhone||'593992890540').replace(/\D/g,'');}
  function shareContacts(phone){const rows=filteredContacts();if(!rows.length)return toast('No hay contactos para exportar');askConfirm('Enviar contactos',`Se enviarán ${rows.length} contactos únicos por WhatsApp.`,()=>{window.open(`https://wa.me/${phone}?text=${encodeURIComponent(exportText())}`,'_blank','noopener');toast('Exportado exitosamente.');},'Abrir WhatsApp');}
  $('#downloadContactsBtn').addEventListener('click',downloadContacts);$('#whatsappDanielBtn').addEventListener('click',()=>shareContacts(whatsappNumberDaniel()));$('#whatsappElenaBtn').addEventListener('click',()=>shareContacts(whatsappNumberElena()));

  // Entrega 6.20 — Seguridad y teléfonos
  function openSecurityAuth(){
    $('#securityCurrentPassword').value='';
    $('#securityAuthError').hidden=true;
    $('#securityAuthDialog').showModal();
    setTimeout(()=>$('#securityCurrentPassword').focus(),50);
  }
  $('#securityAuthForm').addEventListener('submit',e=>{
    e.preventDefault();
    if($('#securityCurrentPassword').value!==securitySettings().password){
      $('#securityAuthError').hidden=false;
      return;
    }
    $('#securityAuthDialog').close();
    const cfg=securitySettings();
    $('#securityNewPassword').value=cfg.password;
    $('#securityConfirmPassword').value=cfg.password;
    $('#securityDanielPhone').value=cfg.danielPhone;
    $('#securityElenaPhone').value=cfg.elenaPhone;
    $('#securityFormError').hidden=true;
    $('#securityDialog').showModal();
    rememberDialogState($('#securityDialog'));
  });
  $('#securityForm').addEventListener('submit',e=>{
    e.preventDefault();
    const password=$('#securityNewPassword').value.trim();
    const confirmPassword=$('#securityConfirmPassword').value.trim();
    const danielPhone=$('#securityDanielPhone').value.replace(/\D/g,'');
    const elenaPhone=$('#securityElenaPhone').value.replace(/\D/g,'');
    const error=$('#securityFormError');
    if(password.length<4){error.textContent='La contraseña debe tener al menos 4 caracteres.';error.hidden=false;return;}
    if(password!==confirmPassword){error.textContent='Las contraseñas no coinciden.';error.hidden=false;return;}
    if(danielPhone.length<8||elenaPhone.length<8){error.textContent='Revisa los números de WhatsApp.';error.hidden=false;return;}
    error.hidden=true;
    askConfirm('Guardar seguridad','Se cambiarán la contraseña del panel y los teléfonos de WhatsApp.',()=>{
      localStorage.setItem('egm-security-settings',JSON.stringify({password,danielPhone,elenaPhone}));
      rememberDialogState($('#securityDialog'));
      toast('Guardado exitosamente');
    },'Guardar');
  });

  // Entrega 6.17 — Subir fotos y editor real de encuadre
  let activePhotoSlot='inicio',photoDrafts={},dragState=null;
  const PHOTO_DEFAULTS={x:50,y:50,zoom:100,intensity:55,direction:'to bottom',color:'#000000',opacity:70};
  function loadPhotoSettings(){try{return JSON.parse(localStorage.getItem('egm-photo-settings')||'{}')}catch(_){return {}}}
  function loadPhotoSources(){try{return JSON.parse(localStorage.getItem('egm-photo-originals')||'{}')}catch(_){return {}}}
  function currentPhotoDraft(){
    if(!photoDrafts[activePhotoSlot]){
      const saved=loadPhotoSettings()[activePhotoSlot]||{},sources=loadPhotoSources();
      photoDrafts[activePhotoSlot]={...PHOTO_DEFAULTS,...saved,src:sources[activePhotoSlot]||saved.src||''};
    }
    return photoDrafts[activePhotoSlot];
  }
  function syncPhotoControls(){
    const d=currentPhotoDraft();
    $('#photoPosX').value=d.x;$('#photoPosY').value=d.y;$('#photoZoom').value=d.zoom;
    $('#gradientIntensity').value=d.intensity;$('#gradientDirection').value=d.direction;
    $('#gradientColor').value=d.color;$('#gradientOpacity').value=d.opacity;
    const preview=$('#photoPreview');preview.classList.toggle('is-inicio',activePhotoSlot==='inicio');preview.classList.toggle('is-hero',activePhotoSlot==='hero');
    $('#photoPreviewLabel').textContent=activePhotoSlot==='inicio'?'Foto inicio':'Foto Hero';
    renderPhotoPreview();
  }
  function renderPhotoPreview(){
    const d=currentPhotoDraft(),img=$('.photo-preview-image'),grad=$('.photo-preview-gradient');
    img.style.backgroundImage=d.src?`url("${d.src}")`:'none';img.style.backgroundPosition=`${d.x}% ${d.y}%`;img.style.backgroundSize=`${d.zoom}%`;
    const alpha=(Number(d.opacity)/100)*(Number(d.intensity)/100);
    grad.style.background=`linear-gradient(${d.direction}, ${hexRgba(d.color,0)} 0%, ${hexRgba(d.color,alpha)} 100%)`;
    $$('.photo-controls input[type=range]').forEach(el=>el.parentElement.querySelector('output').textContent=el.value+'%');
  }
  function hexRgba(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`}
  function openPhotoManager(){
    const settings=structuredClone(loadPhotoSettings()),sources=loadPhotoSources();photoDrafts={};
    ['inicio','hero'].forEach(slot=>{const saved=settings[slot]||{};photoDrafts[slot]={...PHOTO_DEFAULTS,...saved,src:sources[slot]||saved.src||''};});
    activePhotoSlot='inicio';$$('[data-photo-slot]').forEach(b=>b.classList.toggle('is-active',b.dataset.photoSlot===activePhotoSlot));
    syncPhotoControls();$('#photoSourceInput').value='';$('#photoManagerDialog').showModal();rememberDialogState($('#photoManagerDialog'));
  }
  $$('[data-photo-slot]').forEach(b=>b.addEventListener('click',()=>{activePhotoSlot=b.dataset.photoSlot;$$('[data-photo-slot]').forEach(x=>x.classList.toggle('is-active',x===b));syncPhotoControls();$('#photoSourceInput').value='';}));
  $('#photoSourceInput').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;if(!/^image\/(jpeg|png|webp)$/i.test(f.type))return toast('Selecciona una imagen JPG, PNG o WEBP');const r=new FileReader();r.onload=()=>{currentPhotoDraft().src=r.result;currentPhotoDraft().fileName=f.name;renderPhotoPreview();};r.readAsDataURL(f);});
  const photoMap={photoPosX:'x',photoPosY:'y',photoZoom:'zoom',gradientIntensity:'intensity',gradientDirection:'direction',gradientColor:'color',gradientOpacity:'opacity'};
  Object.entries(photoMap).forEach(([id,key])=>$('#'+id).addEventListener('input',e=>{currentPhotoDraft()[key]=e.target.value;renderPhotoPreview();}));
  $('#resetPhotoFrameBtn').addEventListener('click',()=>askConfirm('Restablecer encuadre','La imagen original se conservará y solo se restablecerán los ajustes de esta foto.',()=>{const src=currentPhotoDraft().src,fileName=currentPhotoDraft().fileName;photoDrafts[activePhotoSlot]={...PHOTO_DEFAULTS,src,fileName};syncPhotoControls();},'Restablecer'));
  const preview=$('#photoPreview');
  preview.addEventListener('pointerdown',e=>{if(!currentPhotoDraft().src)return;preview.setPointerCapture(e.pointerId);dragState={id:e.pointerId,startX:e.clientX,startY:e.clientY,x:Number(currentPhotoDraft().x),y:Number(currentPhotoDraft().y)};});
  preview.addEventListener('pointermove',e=>{if(!dragState||dragState.id!==e.pointerId)return;const rect=preview.getBoundingClientRect(),d=currentPhotoDraft();d.x=Math.max(0,Math.min(100,dragState.x+((e.clientX-dragState.startX)/rect.width)*100));d.y=Math.max(0,Math.min(100,dragState.y+((e.clientY-dragState.startY)/rect.height)*100));$('#photoPosX').value=Math.round(d.x);$('#photoPosY').value=Math.round(d.y);renderPhotoPreview();});
  const endDrag=e=>{if(dragState&&(!e||dragState.id===e.pointerId))dragState=null;};preview.addEventListener('pointerup',endDrag);preview.addEventListener('pointercancel',endDrag);
  $('#savePhotoSettingsBtn').addEventListener('click',()=>askConfirm('Guardar fotografías','Se conservarán las imágenes originales y se guardarán por separado únicamente los parámetros de encuadre.',()=>{
    const sources={},settings={};
    Object.entries(photoDrafts).forEach(([slot,d])=>{sources[slot]=d.src||'';const {src,fileName,...params}=d;settings[slot]={...params,fileName:fileName||''};});
    try{localStorage.setItem('egm-photo-originals',JSON.stringify(sources));localStorage.setItem('egm-photo-settings',JSON.stringify(settings));rememberDialogState($('#photoManagerDialog'));toast('Guardado exitosamente');}
    catch(_){toast('La imagen es demasiado grande. Usa una imagen más liviana.');}
  },'Guardar'));


  // Evita que el segundo toque rápido de los controles amplíe la pantalla en Safari/iPhone.
  let lastControlTouch={time:0,target:null};
  document.addEventListener('touchend',event=>{
    const control=event.target.closest('button,.song-action,.mini-btn,[role="button"]');
    if(!control)return;
    const now=Date.now();
    if(lastControlTouch.target===control&&now-lastControlTouch.time<500) event.preventDefault();
    lastControlTouch={time:now,target:control};
  },{passive:false,capture:true});
  document.addEventListener('dblclick',event=>{
    if(event.target.closest('button,.song-action,.mini-btn,[role="button"]')) event.preventDefault();
  },{passive:false,capture:true});

  Promise.all([loadData(),initRemoteSync()]).then(()=>{
    // Siempre abrir primero la ventana de configuración del show.
    // Los datos del último show se conservan para facilitar la siguiente apertura.
    showConfig();
  });
})();

/* Entrega 6.14: la barra permanece fija; solo la hoja usa zoom interno */
(function(){
  const dialog=document.getElementById('songbookEditorDialog');
  const toolbar=dialog&&dialog.querySelector('.songbook-toolbar');
  const stage=dialog&&dialog.querySelector('.songbook-paper-stage');
  if(!dialog||!toolbar||!stage)return;

  let paperZoom=1;
  const controls=document.createElement('div');
  controls.className='songbook-zoom-controls';
  controls.setAttribute('aria-label','Zoom de la hoja');
  controls.innerHTML='<button type="button" data-paper-zoom="out" aria-label="Alejar hoja">−</button><span class="songbook-zoom-value">100%</span><button type="button" data-paper-zoom="in" aria-label="Acercar hoja">+</button>';
  toolbar.appendChild(controls);
  const value=controls.querySelector('.songbook-zoom-value');

  function applyPaperZoom(next){
    paperZoom=Math.min(2,Math.max(.5,Math.round(next*10)/10));
    stage.style.setProperty('--songbook-paper-zoom',String(paperZoom));
    value.textContent=`${Math.round(paperZoom*100)}%`;
    requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }
  controls.addEventListener('click',e=>{
    const action=e.target.closest('[data-paper-zoom]')?.dataset.paperZoom;
    if(action==='in')applyPaperZoom(paperZoom+.1);
    if(action==='out')applyPaperZoom(paperZoom-.1);
  });

  document.addEventListener('keydown',e=>{
    if(!dialog.open||!(e.ctrlKey||e.metaKey))return;
    if(e.key==='+'||e.key==='='){e.preventDefault();applyPaperZoom(paperZoom+.1);}
    else if(e.key==='-'){e.preventDefault();applyPaperZoom(paperZoom-.1);}
    else if(e.key==='0'){e.preventDefault();applyPaperZoom(1);}
  },{capture:true});

  dialog.addEventListener('wheel',e=>{
    if(!dialog.open||!(e.ctrlKey||e.metaKey))return;
    e.preventDefault();
    applyPaperZoom(paperZoom+(e.deltaY<0?.1:-.1));
  },{passive:false,capture:true});

  applyPaperZoom(1);
})();
