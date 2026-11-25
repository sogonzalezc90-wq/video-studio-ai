(() => {
  const $ = (id) => document.getElementById(id);
  let supabaseClient = null;
  let projects = [];
  const META_PREFIX = 'VSA_VIDEO_PROJECT_V1\n';
  const durationSelect = document.getElementById('video-duration');
  if (durationSelect) {
    durationSelect.innerHTML = '';
    for (let seconds=15; seconds<=1200; seconds+=15) {
      const option=document.createElement('option');
      option.value=String(seconds);
      option.textContent=seconds<60 ? `${seconds} segundos` : (seconds%60===0 ? `${seconds/60} minutos` : `${Math.floor(seconds/60)} min ${seconds%60} s`);
      if(seconds===15) option.selected=true;
      durationSelect.append(option);
    }
  }

  const message = (id, text, error=false) => {
    const el = $(id); if (!el) return;
    el.textContent = text; el.style.color = error ? '#b42318' : '#936b20';
  };
  const credentials = () => ({url:$('supabase-url').value.trim(),key:$('supabase-key').value.trim()});
  function connect() {
    const {url,key} = credentials();
    if (!url || !key) throw new Error('Introduce el Project URL y la Publishable key de Supabase.');
    if (!window.supabase?.createClient) throw new Error('No se pudo cargar la biblioteca de Supabase. Revisa tu conexión a internet.');
    supabaseClient = window.supabase.createClient(url,key);
    localStorage.setItem('vsa_url',url); localStorage.setItem('vsa_key',key);
    return supabaseClient;
  }
  function client() { if (!supabaseClient) connect(); return supabaseClient; }
  function readProjectDescription(value) {
    if (!value || !value.startsWith(META_PREFIX)) return {description:value || 'Sin descripción'};
    try { return JSON.parse(value.slice(META_PREFIX.length)); }
    catch { return {description:value}; }
  }
  function escapeHtml(value='') {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  async function auth(action) {
    try {
      const sb=client(), email=$('email').value.trim(), password=$('password').value;
      if(!email || !password) throw new Error('Escribe tu correo y contraseña.');
      const result=action==='signup' ? await sb.auth.signUp({email,password}) : await sb.auth.signInWithPassword({email,password});
      if(result.error) throw result.error;
      if(action==='signup' && !result.data.session) { message('auth-message','Cuenta creada. Revisa tu correo para confirmar el registro.'); return; }
      message('auth-message','Acceso correcto.'); await showApp(result.data.user);
    } catch(e) { message('auth-message',e.message,true); }
  }
  async function showApp(user) {
    $('auth-panel').classList.add('hidden'); $('app-panel').classList.remove('hidden'); $('user-label').textContent=user?.email||'';
    await Promise.all([loadProjects(),checkGeneration()]);
  }
  async function loadProjects() {
    try {
      const {data,error}=await client().from('projects').select('*').order('created_at',{ascending:false});
      if(error) throw error; projects=data||[];
      $('projects-list').innerHTML=''; $('asset-project').innerHTML='<option value="">Selecciona un proyecto</option>';
      if(!projects.length) $('projects-list').innerHTML='<p class="muted">Todavía no tienes proyectos. Prepara el primero.</p>';
      projects.forEach(p=>{
        const meta=readProjectDescription(p.description);
        const card=document.createElement('article'); card.className='project-card';
        const title=document.createElement('h4'); title.textContent=p.name;
        const desc=document.createElement('p'); desc.textContent=meta.prompt || meta.description || 'Sin descripción';
        const detail=document.createElement('small');
        detail.textContent=meta.durationSeconds ? `${formatDuration(meta.durationSeconds)} · ${meta.style} · ${meta.profileLabel || 'Proyecto preparado'}` : new Date(p.created_at).toLocaleDateString('es-MX');
        card.append(title,desc,detail); $('projects-list').append(card);
        const opt=document.createElement('option'); opt.value=p.id; opt.textContent=p.name; $('asset-project').append(opt);
      });
      const source=$('video-project-source');
      if(source) {
        const selected=source.value;
        source.innerHTML='<option value="">Crear un proyecto nuevo</option>';
        projects.forEach(p=>{const opt=document.createElement('option');opt.value=p.id;opt.textContent=p.name;source.append(opt);});
        if(projects.some(p=>p.id===selected)) source.value=selected;
      }
    } catch(e) { message('video-message',e.message,true); }
  }
  async function selectExistingProject() {
    const id=$('video-project-source')?.value;
    const status=$('video-project-status');
    if(!id) {
      if(status) status.textContent='Se creará un proyecto nuevo. También puedes adjuntar imágenes o usar solo texto.';
      return;
    }
    const project=projects.find(p=>p.id===id);
    if(!project) throw new Error('No se encontró el proyecto seleccionado en tu biblioteca.');
    const meta=readProjectDescription(project.description);
    $('video-name').value=project.name || '';
    $('video-prompt').value=project.prompt || meta.prompt || '';
    try {
      const {data:{user}}=await client().auth.getUser();
      const {data,error}=await client().from('project_assets').select('id,mime_type')
        .eq('project_id',id).eq('user_id',user.id);
      if(error) throw error;
      const images=(data||[]).filter(x=>String(x.mime_type||'').startsWith('image/')).length;
      const videos=(data||[]).filter(x=>String(x.mime_type||'').startsWith('video/')).length;
      const count=images+videos;
      if(status) status.textContent=count
        ? `Proyecto seleccionado: ${project.name}. Tiene ${images} imagen(es) y ${videos} video(s) guardado(s); serán referencias visuales obligatorias.`
        : `Proyecto seleccionado: ${project.name}. No tiene referencias visuales; agrega imágenes o videos antes de producir.`;
    } catch(e) {
      if(status) status.textContent='Proyecto seleccionado: '+project.name+'. Se validarán las imágenes y videos de referencia al enviar el trabajo.';
    }
  }
  function collectVideoSettings() {
    const prompt=$('video-prompt').value.trim(), name=$('video-name').value.trim();
    if(!name) throw new Error('Escribe el nombre del proyecto.');
    if(prompt.length<30) throw new Error('Describe tu video con al menos 30 caracteres para guardar instrucciones útiles.');
    const durationSeconds=Number($('video-duration').value);
    const profile=$('video-profile').value;
    const profileLabel={balanced:'Equilibrado',cinematic:'Cinematográfico',light:'Ligero'}[profile];
    return {version:1,prompt,durationSeconds,style:$('video-style').value,inputMode:$('video-input-mode').value,profile,profileLabel,voice:$('video-voice').value,resolution:$('video-resolution').value,productionStatus:'preproduction',createdAt:new Date().toISOString()};
  }
  function formatDuration(seconds) {
    if(seconds<60) return `${seconds} segundos`;
    const minutes=seconds/60;
    return Number.isInteger(minutes) ? `${minutes} min` : `${Math.floor(minutes)} min ${seconds%60} s`;
  }
  async function saveVideoProject() {
    try {
      const name=$('video-name').value.trim(), settings=collectVideoSettings();
      const {data:{user},error:userError}=await client().auth.getUser();
      if(userError) throw userError; if(!user) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
      const description=META_PREFIX+JSON.stringify(settings);
      const {error}=await client().from('projects').insert({name,prompt:settings.prompt,description,user_id:user.id});
      if(error) throw error;
      message('video-message','Proyecto y configuración guardados en tu biblioteca. Todavía no se ha enviado a generar.');
      $('video-prompt').value=''; $('video-name').value='';
      if($('video-reference-files')) $('video-reference-files').value=''; await loadProjects();
    } catch(e) { message('video-message',e.message,true); }
  }
  async function uploadAsset() {
    try {
      const file=$('asset-file').files[0], projectId=$('asset-project').value;
      if(!file||!projectId) throw new Error('Selecciona una imagen o video y un proyecto.');
      if(!(['image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime'].includes(file.type))) throw new Error('Formato no compatible. Usa PNG, JPG, WEBP, MP4, WEBM o MOV.');
      const {data:{user}}=await client().auth.getUser();
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'), path=`${user.id}/${projectId}/${Date.now()}-${safeName}`;
      const {error:uploadError}=await client().storage.from('video-assets').upload(path,file,{upsert:false}); if(uploadError) throw uploadError;
      const {error:dbError}=await client().from('project_assets').insert({project_id:projectId,user_id:user.id,storage_path:path,file_name:file.name,mime_type:file.type}); if(dbError) throw dbError;
      message('upload-message','Referencia visual guardada en tu almacenamiento privado.'); $('asset-file').value='';
    } catch(e) { message('upload-message',e.message,true); }
  }
  async function startGeneration() {
    try {
      const settings=collectVideoSettings();
      const {data:{user},error:userError}=await client().auth.getUser();
      if(userError) throw userError;
      const {data:{session:activeSession}}=await client().auth.getSession();
      if(!user || !activeSession?.access_token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');

      const selectedId=$('video-project-source')?.value || '';
      let project;
      const description=META_PREFIX+JSON.stringify(settings);
      if(selectedId) {
        const existing=projects.find(p=>p.id===selectedId);
        if(!existing) throw new Error('Actualiza la biblioteca y vuelve a seleccionar el proyecto.');
        // Reuse the existing project without requiring UPDATE permission on projects.
        // The current prompt is stored on the video job; existing project assets stay attached.
        project={id:existing.id};
      } else {
        const {data,error}=await client().from('projects')
          .insert({name:$('video-name').value.trim(),prompt:settings.prompt,description,user_id:user.id})
          .select('id').single();
        if(error) throw error;
        project=data;
      }

      const referenceFiles=Array.from($('video-reference-files')?.files || []);
      for(let i=0;i<referenceFiles.length;i++) {
        const file=referenceFiles[i];
        if(!['image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime'].includes(file.type)) throw new Error('Usa imágenes PNG/JPG/WEBP o videos MP4/WEBM/MOV.');
        const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        const storagePath=`${user.id}/${project.id}/${Date.now()}-${i}-${safeName}`;
        const {error:uploadError}=await client().storage.from('video-assets').upload(storagePath,file,{upsert:false});
        if(uploadError) throw new Error('No se pudo guardar una imagen de referencia: '+uploadError.message);
        const {error:assetError}=await client().from('project_assets').insert({
          project_id:project.id,user_id:user.id,storage_path:storagePath,file_name:file.name,mime_type:file.type
        });
        if(assetError) throw new Error('La imagen se guardó, pero no se pudo asociar al proyecto: '+assetError.message);
      }

      const {url,key}=credentials();
      const response=await fetch('/api/jobs',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':`Bearer ${activeSession.access_token}`,
          'apikey':key,
          'x-supabase-url':url
        },
        body:JSON.stringify({
          projectId:project.id,
          prompt:settings.prompt,
          durationSeconds:settings.durationSeconds,
          segmentSeconds:settings.durationSeconds%30===0?30:15,
          resolution:settings.resolution,
          style:settings.style,
          voice:settings.voice,
          inputMode:settings.inputMode,
          productionProfile:settings.profile
        })
      });
      const result=await response.json();
      if(!response.ok) throw new Error(result.message||result.error||'No se pudo enviar el trabajo a la cola.');
      const imageCount=Number(result.job?.payload?.reference_media_count || result.job?.payload?.reference_image_count || 0);
      const imageNote=settings.inputMode==='text' ? ' Producción basada en texto.' : ` Supabase confirmó ${imageCount} imagen(es)/video(s) del proyecto; se usarán como referencias visuales y de continuidad Wan 2.2.`;
      const dialogueStatus=result.audio_script_mode==='ai_dialogue_generated'
        ? ' Guion de diálogos generado por IA.'
        : ' Se usarán los diálogos escritos explícitamente; si no hay, solo el diseño sonoro por escena.';
      message('video-message',`Trabajo registrado en Supabase. ID: ${result.job.id}. Duración solicitada: ${formatDuration(settings.durationSeconds)}.${imageNote}${dialogueStatus} Kaggle debe estar activo.`);
      $('video-prompt').value=''; $('video-name').value='';
      $('video-project-source').value='';
      if($('video-reference-files')) $('video-reference-files').value='';
      await loadProjects();
      await checkGeneration();
    } catch(e) { message('video-message',e.message,true); }
  }
  async function handleJobAction(id, action, button) {
    const prompt = action === 'cancel'
      ? '¿Deseas detener este trabajo? Si Wan 2.2 está generando un clip, Kaggle enviará una interrupción y confirmará cuando sea seguro eliminarlo.'
      : '¿Eliminar definitivamente este trabajo y su video MP4 guardado?';
    if (!window.confirm(prompt)) return;
    try {
      button.disabled = true;
      const {data:{session}} = await client().auth.getSession();
      if (!session?.access_token) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
      const response = await fetch('/api/jobs', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': credentials().key,
          'x-supabase-url': credentials().url
        },
        body: JSON.stringify({id, action})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'No se pudo completar la acción.');
      message('generation-message', result.message || (action === 'cancel' ? 'Detención solicitada.' : 'Trabajo eliminado.'));
      await checkGeneration();
    } catch (e) {
      message('generation-message', e.message, true);
      button.disabled = false;
    }
  }
  async function checkGeneration() {
    const status=$('engine-status');
    try {
      const {data:{session}}=await client().auth.getSession();
      if(!session?.access_token) throw new Error('Inicia sesión para consultar la cola de producción.');
      const response=await fetch('/api/jobs',{
        method:'GET',
        headers:{'Accept':'application/json','Authorization':`Bearer ${session.access_token}`,'apikey':credentials().key,'x-supabase-url':credentials().url}
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data.message||'No se pudo consultar la cola.');
      status.innerHTML=`<span class="status-dot ${data.ready?'ready':'pending'}"></span><span>${escapeHtml(data.label||'Estado consultado')}</span>`;
      const jobsBox=$('generation-jobs');
      if(jobsBox) {
        if(!jobsBox.dataset.actionsBound) {
          jobsBox.addEventListener('click', event => {
            const button = event.target.closest('button[data-job-action]');
            if (!button) return;
            handleJobAction(button.dataset.jobId, button.dataset.jobAction, button);
          });
          jobsBox.dataset.actionsBound = 'true';
        }
        if(!data.jobs?.length) jobsBox.innerHTML='<p class="muted">No hay trabajos de generación todavía.</p>';
        else jobsBox.innerHTML=data.jobs.map(job=>{
          const state={queued:'En espera de GPU',processing:'Generando escenas',assembling:'Ensamblando MP4',cancelling:'Deteniendo proceso…',completed:'Video terminado',failed:'Error de generación',cancelled:'Cancelado'}[job.status]||job.status;
          const download=job.download_url && job.status==='completed'
            ? `<p><a href="${escapeHtml(job.download_url)}" target="_blank" rel="noopener">Abrir video MP4</a></p>` : '';
          const error=job.error_message ? `<p class="message">${escapeHtml(job.error_message)}</p>` : '';
          const actionButton = ['queued','processing','assembling'].includes(job.status)
            ? `<button type="button" class="danger-button" data-job-action="cancel" data-job-id="${escapeHtml(job.id)}">${job.status==='queued'?'Cancelar trabajo':'Detener proceso'}</button>`
            : job.status === 'cancelling'
              ? '<button type="button" class="secondary" disabled>Esperando confirmación de Kaggle…</button>'
              : `<button type="button" class="danger-button" data-job-action="delete" data-job-id="${escapeHtml(job.id)}">Eliminar trabajo</button>`;
          return `<article class="project-item"><div><strong>${escapeHtml(formatDuration(job.duration_seconds))}</strong><p class="muted">${escapeHtml(state)} · ${Number(job.progress)||0}% · ${Number(job.completed_segments)||0}/${Number(job.total_segments)||0} segmentos</p><progress max="100" value="${Math.max(0,Math.min(100,Number(job.progress)||0))}"></progress>${download}${error}<div class="button-row">${actionButton}</div></div></article>`;
        }).join('');
      }
      message('generation-message','Estado de la cola actualizado. La generación avanza únicamente mientras el worker GPU de Kaggle está activo.');
    } catch(e) {
      status.innerHTML='<span class="status-dot pending"></span><span>Cola de producción no disponible</span>';
      message('generation-message',e.message,true);
    }
  }
  $('login-btn').addEventListener('click',()=>auth('login'));
  $('signup-btn').addEventListener('click',()=>auth('signup'));
  $('save-video-btn')?.addEventListener('click',saveVideoProject);
  $('generate-video-btn').addEventListener('click',startGeneration);
  $('video-project-source').addEventListener('change',()=>selectExistingProject().catch(e=>message('video-message',e.message,true)));
  $('clear-video-btn').addEventListener('click',()=>{['video-name','video-prompt'].forEach(id=>$(id).value='');$('video-project-source').value='';$('video-reference-files').value='';selectExistingProject();message('video-message','Formulario limpio.');});
  $('upload-btn').addEventListener('click',uploadAsset);
  $('refresh-btn').addEventListener('click',loadProjects);
  $('generation-test-btn').addEventListener('click',checkGeneration);
  $('logout-btn').addEventListener('click',async()=>{try{await client().auth.signOut();}finally{$('app-panel').classList.add('hidden');$('auth-panel').classList.remove('hidden');}});
  $('supabase-url').value=localStorage.getItem('vsa_url')||''; $('supabase-key').value=localStorage.getItem('vsa_key')||'';
  try { if($('supabase-url').value&&$('supabase-key').value){connect();client().auth.getSession().then(({data})=>{if(data.session)showApp(data.session.user);});} } catch(e) { console.warn(e); }
})();
