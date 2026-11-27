(() => {
  const $ = (id) => document.getElementById(id);
  let supabaseClient = null;
  let projects = [];
  let projectNames = new Map();

  const message = (id, text, error=false) => {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.style.color = error ? "var(--danger, #ffaaa3)" : "var(--gold-bright, #f0cf8a)";
  };
  const credentials = () => ({
    url: $("supabase-url").value.trim(),
    key: $("supabase-key").value.trim()
  });
  function validateCredentials(url,key) {
    if (!url || !key) throw new Error("Introduce el Project URL y la Publishable key de Supabase.");
    // Supabase sends the public key in the HTTP apikey header. Header values
    // must be ASCII here; Unicode/zero-width characters trigger the browser's
    // "String contains non ISO-8859-1 code point" RequestInit error.
    if (!key.split("").every(character => character.charCodeAt(0) >= 33 && character.charCodeAt(0) <= 126)) {
      throw new Error("La Publishable key contiene espacios internos o caracteres invisibles/no ASCII. Elimina ese valor del campo y pega la clave pública exacta de Supabase (sin comillas ni saltos de línea).");
    }
    if (Array.from(url).some(character => { const code=character.codePointAt(0); return code <= 32 || code > 126; })) {
      throw new Error("El Project URL contiene espacios o caracteres no válidos. Debe ser una URL HTTPS de Supabase.");
    }
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error("El Project URL no tiene un formato válido."); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("El Project URL debe ser una dirección HTTPS válida, sin usuario, contraseña, parámetros ni fragmentos.");
    }
  }
  function connect() {
    const {url,key} = credentials();
    validateCredentials(url,key);
    if (!window.supabase?.createClient) throw new Error("No se pudo cargar la biblioteca de Supabase. Revisa tu conexión a internet.");
    supabaseClient = window.supabase.createClient(url,key);
    localStorage.setItem("vsa_url",url);
    localStorage.setItem("vsa_key",key);
    return supabaseClient;
  }
  function client() { if (!supabaseClient) connect(); return supabaseClient; }
  window.VSASupabaseClient = client;
  window.VSAGetSessionToken = async () => {
    const {data,error}=await client().auth.getSession();
    if(error) throw error;
    const token=data?.session?.access_token;
    if(!token) throw new Error("Tu sesión expiró. Vuelve a iniciar sesión para generar voces.");
    return token;
  };

  async function auth(action) {
    try {
      const sb = client(), email=$("email").value.trim(), password=$("password").value;
      if (!email || !password) throw new Error("Escribe tu correo y contraseña.");
      const result = action === "signup"
        ? await sb.auth.signUp({email,password})
        : await sb.auth.signInWithPassword({email,password});
      if (result.error) throw result.error;
      if (action === "signup" && !result.data.session) {
        message("auth-message","Cuenta creada. Revisa tu correo para confirmar el registro.");
        return;
      }
      message("auth-message","Acceso correcto.");
      await showApp(result.data.user);
    } catch(e) { message("auth-message",e.message,true); }
  }
  async function showApp(user) {
    $("auth-panel").classList.add("hidden");
    $("app-panel").classList.remove("hidden");
    $("user-label").textContent = user?.email || "";
    await loadProjects();
  }
  async function loadProjects() {
    const root=$("projects-list");
    try {
      const {data,error}=await client().from("projects")
        .select("id,name,description,created_at").order("created_at",{ascending:false});
      if(error) throw error;
      projects=data||[];
      projectNames=new Map(projects.map(project=>[project.id,project.name]));
      root.replaceChildren();
      $("asset-project").innerHTML='<option value="">Selecciona un proyecto</option>';
      $("generation-project").innerHTML='<option value="">Selecciona un proyecto</option>';
      if(!projects.length) root.innerHTML='<p class="muted">Todavía no tienes proyectos. Crea el primero.</p>';
      projects.forEach(p=>{
        const card=document.createElement("article"); card.className="project-card";
        const title=document.createElement("h4"); title.textContent=p.name;
        const desc=document.createElement("p"); desc.textContent=p.description||"Sin descripción";
        const date=document.createElement("small"); date.textContent=new Date(p.created_at).toLocaleDateString("es-MX");
        card.append(title,desc,date);
        const removeButton=document.createElement("button");
        removeButton.type="button";
        removeButton.className="danger-button";
        removeButton.textContent="Eliminar proyecto";
        removeButton.addEventListener("click",()=>deleteProject(p,removeButton));
        card.append(removeButton);
        root.append(card);
        [$("asset-project"),$("generation-project")].forEach(select=>{
          const opt=document.createElement("option"); opt.value=p.id; opt.textContent=p.name; select.append(opt);
        });
      });
      // A media-library failure must never prevent projects from appearing.
      try { await loadAssets(); }
      catch(assetError) { message("upload-message","No se pudieron cargar los archivos: "+formatSupabaseError(assetError),true); }
      try { await loadWanJobs(); } catch(_) {}
      return projects;
    } catch(e) {
      projects=[];
      root.replaceChildren();
      const note=document.createElement("p");
      note.className="message";
      note.textContent="No se pudo consultar public.projects: "+formatSupabaseError(e);
      root.append(note);
      message("project-message",note.textContent,true);
      return [];
    }
  }
  function formatSupabaseError(error) {
    if(!error) return "Error desconocido.";
    const parts=[error.message,error.code&&("Código "+error.code),error.details,error.hint].filter(Boolean);
    return parts.join(" · ")||String(error);
  }
  async function diagnoseConnection() {
    const button=$("diagnose-btn");
    if(button) { button.disabled=true; button.textContent="Diagnosticando…"; }
    try {
      const sb=client(), checks=[];
      const sessionResult=await sb.auth.getSession();
      if(sessionResult.error) throw sessionResult.error;
      const session=sessionResult.data?.session;
      checks.push(session?.user?.id?"Sesión Supabase: correcta":"Sesión Supabase: no encontrada");
      if(session?.user?.id) {
        const projectResult=await sb.from("projects").select("id").limit(1);
        checks.push(projectResult.error
          ?"Tabla projects: ERROR — "+formatSupabaseError(projectResult.error)
          :"Tabla projects: lectura correcta");
        const assetResult=await sb.from("project_assets").select("id").limit(1);
        checks.push(assetResult.error
          ?"Tabla project_assets: ERROR — "+formatSupabaseError(assetResult.error)
          :"Tabla project_assets: lectura correcta");
      }
      const apiResponse=await fetch("/api/jobs",{method:"GET",cache:"no-store",headers:{Accept:"application/json"}});
      const apiResult=await apiResponse.json().catch(()=>({}));
      checks.push(apiResponse.ok
        ?"Cloudflare API: responde"+(apiResult.diagnostics?" · AI="+(apiResult.diagnostics.AI?"sí":"no")+" · Supabase env="+(apiResult.diagnostics.SUPABASE_URL&&apiResult.diagnostics.SUPABASE_ANON_KEY?"sí":"no"):"")
        :"Cloudflare API: HTTP "+apiResponse.status+" — "+(apiResult.message||apiResult.error||"sin detalle"));
      message("project-message",checks.join(" | "),checks.some(item=>item.includes("ERROR")||item.includes("no encontrada")||item.includes("HTTP ")));
    } catch(error) {
      message("project-message","Diagnóstico detenido: "+formatSupabaseError(error),true);
    } finally {
      if(button) { button.disabled=false; button.textContent="Diagnóstico de conexión"; }
    }
  }
  async function loadAssets() {
    const root=$("assets-list");
    if(!root) return;
    root.replaceChildren();
    const {data,error}=await client().from("project_assets")
      .select("id,project_id,storage_path,file_name,mime_type,asset_type,created_at")
      .order("created_at",{ascending:false});
    if(error) throw error;
    window.VSAAvailableAssets=[];
    if(!data?.length){
      const empty=document.createElement("p");
      empty.className="muted"; empty.textContent="Todavía no hay imágenes ni videos guardados.";
      root.append(empty);
      window.dispatchEvent(new CustomEvent("vsa-assets-loaded",{detail:{assets:[]}}));
      return;
    }
    for(const asset of data){
      const card=document.createElement("article"); card.className="project-card asset-card";
      const heading=document.createElement("h4");
      heading.textContent=(projectNames.get(asset.project_id)||"Proyecto")+" · "+asset.file_name;
      const meta=document.createElement("small");
      meta.textContent=(asset.asset_type||"image").toUpperCase()+" · "+new Date(asset.created_at).toLocaleString("es-MX");
      card.append(heading,meta);
      const {data:signed,error:signedError}=await client().storage.from("video-assets").createSignedUrl(asset.storage_path,3600);
      if(!signedError)window.VSAAvailableAssets.push({id:asset.id,projectId:asset.project_id,url:signed.signedUrl,storagePath:asset.storage_path,name:asset.file_name,type:asset.asset_type||"image",mime:asset.mime_type||""});
      if(signedError){
        const note=document.createElement("p"); note.className="muted"; note.textContent="No se pudo generar el enlace privado de este archivo."; card.append(note);
      } else if((asset.asset_type||"image")==="video" || (asset.mime_type||"").startsWith("video/")){
        const video=document.createElement("video"); video.controls=true; video.preload="metadata"; video.src=signed.signedUrl;
        video.style.cssText="display:block;width:100%;max-height:260px;border-radius:10px;margin-top:10px"; card.append(video);
      } else {
        const image=document.createElement("img"); image.loading="lazy"; image.alt=asset.file_name; image.src=signed.signedUrl;
        image.style.cssText="display:block;width:100%;max-height:260px;object-fit:contain;border-radius:10px;margin-top:10px"; card.append(image);
      }
      const removeButton=document.createElement("button");
      removeButton.type="button";removeButton.className="danger-button";removeButton.textContent=(asset.asset_type||"image")==="video"?"Eliminar video":"Eliminar imagen";
      removeButton.addEventListener("click",()=>deleteAsset(asset,removeButton));
      card.append(removeButton);
      root.append(card);
    }
    window.dispatchEvent(new CustomEvent("vsa-assets-loaded",{detail:{assets:window.VSAAvailableAssets}}));
  }
  async function deleteAsset(asset,button) {
    if(!asset?.id||!asset?.storage_path) return;
    const kind=(asset.asset_type||"archivo").toLowerCase();
    if(!window.confirm("¿Eliminar definitivamente este "+kind+"? Esta acción no se puede deshacer.")) return;
    button.disabled=true;
    try {
      const {error:storageError}=await client().storage.from("video-assets").remove([asset.storage_path]);
      if(storageError) throw new Error("No se pudo eliminar el archivo del almacenamiento: "+storageError.message);
      const {error:rowError}=await client().from("project_assets").delete().eq("id",asset.id);
      if(rowError) throw new Error("El archivo se eliminó del almacenamiento, pero no se pudo borrar su registro: "+rowError.message);
      await loadAssets();
    } catch(error) {
      alert(error.message);
      button.disabled=false;
    }
  }
  async function createProject() {
    const button=$("create-project-btn");
    try {
      const name=$("project-name").value.trim();
      const description=$("project-description").value.trim();
      if(!name) throw new Error("Escribe el nombre del proyecto.");
      if(name.length>120) throw new Error("El nombre del proyecto no puede superar 120 caracteres.");
      button.disabled=true;
      message("project-message","Guardando el proyecto en tu biblioteca privada…");
      const sb=client();
      const {data:{user},error:userError}=await sb.auth.getUser();
      if(userError) throw userError;
      if(!user?.id) throw new Error("No hay una sesión válida. Vuelve a iniciar sesión.");

      // Current schema first; subsequent attempts cover known legacy schemas.
      const attempts=[
        {record:{name,description,user_id:user.id},columns:"id,name,description,created_at"},
        {record:{name,description,prompt:description||name,user_id:user.id},columns:"id,name,description,created_at"},
        {record:{name,prompt:description||name,user_id:user.id},columns:"id,name,created_at"},
        {record:{name,user_id:user.id},columns:"id,name,created_at"}
      ];
      let savedProject=null,lastError=null;
      for(const attempt of attempts){
        const result=await sb.from("projects").insert(attempt.record).select(attempt.columns).single();
        if(!result.error && result.data?.id){savedProject={...result.data,description:result.data.description??description};break;}
        if(!result.error) throw new Error("La base de datos no devolvió el proyecto guardado. Comprueba los permisos SELECT de public.projects.");
        lastError=result.error;
        const code=String(result.error.code||"");
        const detail=String(result.error.message||"");
        const legacyMismatch=["23502","42703","PGRST204"].includes(code)
          ||/column .*does not exist|could not find .*column|null value in column .*prompt|schema cache/i.test(detail);
        if(!legacyMismatch) throw new Error(formatSupabaseError(result.error));
      }
      if(!savedProject) throw new Error("No se pudo guardar el proyecto. "+formatSupabaseError(lastError));
      const refreshed=await loadProjects();
      if(!refreshed.some(project=>project.id===savedProject.id))
        throw new Error("El proyecto fue insertado, pero no apareció al volver a leer la biblioteca. Revisa las políticas SELECT de public.projects.");
      $("project-name").value="";
      $("project-description").value="";
      $("generation-project").value=savedProject.id;
      $("asset-project").value=savedProject.id;
      message("project-message","Proyecto creado, guardado y verificado en tu biblioteca.");
    } catch(error) {
      message("project-message","No se pudo crear el proyecto: "+formatSupabaseError(error),true);
    } finally {
      if(button) button.disabled=false;
    }
  }

  async function deleteProject(project,button) {
    if(!project?.id) return;
    const confirmed=window.confirm(
      '¿Eliminar definitivamente el proyecto "'+project.name+'"?\\n\\n' +
      "También se eliminarán sus imágenes, videos, planes y trabajos terminados. Esta acción no se puede deshacer."
    );
    if(!confirmed) return;
    if(button) button.disabled=true;
    message("project-message",'Preparando la eliminación de "'+project.name+'"…');
    try {
      const sb=client();
      const {data:{user},error:userError}=await sb.auth.getUser();
      if(userError) throw userError;
      if(!user?.id) throw new Error("La sesión expiró. Vuelve a iniciar sesión.");

      const [assetsResult,jobsResult]=await Promise.all([
        sb.from("project_assets").select("id,storage_path").eq("project_id",project.id).eq("user_id",user.id),
        sb.from("video_jobs").select("id,status,output_path").eq("project_id",project.id).eq("user_id",user.id)
      ]);
      if(assetsResult.error) throw new Error("No se pudieron consultar los archivos del proyecto: "+formatSupabaseError(assetsResult.error));
      if(jobsResult.error) throw new Error("No se pudieron consultar los trabajos del proyecto: "+formatSupabaseError(jobsResult.error));

      const activeStatuses=new Set(["queued","processing","assembling","cancelling"]);
      const activeJobs=(jobsResult.data||[]).filter(job=>activeStatuses.has(job.status));
      if(activeJobs.length)
        throw new Error("Este proyecto tiene "+activeJobs.length+" trabajo(s) de video en espera o en proceso. Cancélalos y espera a que terminen antes de eliminar el proyecto.");

      const assetPaths=[...new Set((assetsResult.data||[]).map(asset=>asset.storage_path).filter(Boolean))];
      const renderPaths=new Set((jobsResult.data||[]).map(job=>job.output_path).filter(Boolean));
      const renderBucket=sb.storage.from("video-renders");
      // Wan 2.2 also stores continuity/master frames below user_id/job_id/continuity.
      // Collect every nested object for each job, not only the final MP4.
      for(const job of jobsResult.data||[]){
        const pendingFolders=[user.id+"/"+job.id];
        while(pendingFolders.length){
          const folder=pendingFolders.pop();
          const {data:entries,error:listError}=await renderBucket.list(folder,{limit:1000});
          if(listError) throw new Error("No se pudieron enumerar los archivos de video del proyecto: "+formatSupabaseError(listError));
          for(const entry of entries||[]){
            const objectPath=folder+"/"+entry.name;
            if(entry.id||entry.metadata) renderPaths.add(objectPath);
            else pendingFolders.push(objectPath);
          }
        }
      }
      const removeInBatches=async(bucket,paths)=>{
        const unique=[...new Set(paths)];
        for(let offset=0;offset<unique.length;offset+=100){
          const batch=unique.slice(offset,offset+100);
          const {error}=await sb.storage.from(bucket).remove(batch);
          if(error) throw new Error("No se pudieron eliminar todos los archivos de "+bucket+": "+formatSupabaseError(error));
        }
      };
      await removeInBatches("video-assets",assetPaths);
      await removeInBatches("video-renders",[...renderPaths]);

      const jobsDelete=await sb.from("video_jobs").delete()
        .eq("project_id",project.id).eq("user_id",user.id).select("id");
      if(jobsDelete.error) throw new Error("No se pudieron eliminar los trabajos vinculados: "+formatSupabaseError(jobsDelete.error));

      const manifestsDelete=await sb.from("production_manifests").delete()
        .eq("project_id",project.id).eq("user_id",user.id).select("id");
      if(manifestsDelete.error) throw new Error("No se pudieron eliminar los planes de producción: "+formatSupabaseError(manifestsDelete.error));

      const assetsDelete=await sb.from("project_assets").delete()
        .eq("project_id",project.id).eq("user_id",user.id).select("id");
      if(assetsDelete.error) throw new Error("No se pudieron eliminar los registros de archivos: "+formatSupabaseError(assetsDelete.error));

      const projectDelete=await sb.from("projects").delete()
        .eq("id",project.id).eq("user_id",user.id).select("id").single();
      if(projectDelete.error) throw new Error("Supabase no permitió eliminar el proyecto: "+formatSupabaseError(projectDelete.error));
      if(!projectDelete.data?.id) throw new Error("No se confirmó la eliminación del proyecto.");

      await loadProjects();
      message("project-message",'Proyecto "'+project.name+'" y sus archivos vinculados eliminados correctamente.');
    } catch(error) {
      message("project-message","No se pudo completar la eliminación: "+formatSupabaseError(error),true);
      try { await loadProjects(); } catch(_) {}
    } finally {
      if(button) button.disabled=false;
    }
  }

  async function uploadAsset() {
    try {
      const file=$("asset-file").files[0], projectId=$("asset-project").value;
      if(!file || !projectId) throw new Error("Selecciona una imagen o video y un proyecto.");
      const assetType=file.type.startsWith("video/")?"video":file.type.startsWith("image/")?"image":null;
      if(!assetType) throw new Error("Solo puedes subir imágenes o videos.");
      const {data:{user}}=await client().auth.getUser();
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      const path=`${user.id}/${projectId}/${Date.now()}-${safeName}`;
      const {error:uploadError}=await client().storage.from("video-assets").upload(path,file,{upsert:false});
      if(uploadError) throw uploadError;
      const {error:dbError}=await client().from("project_assets").insert({project_id:projectId,user_id:user.id,storage_path:path,file_name:file.name,mime_type:file.type,asset_type:assetType});
      if(dbError){ await client().storage.from("video-assets").remove([path]); throw dbError; }
      message("upload-message",(assetType==="video"?"Video":"Imagen")+" guardado en tu almacenamiento privado.");
      $("asset-file").value="";
      await loadAssets();
    } catch(e) { message("upload-message",e.message,true); }
  }

  async function generateImage() {
    const button=$("generate-image-btn");
    try {
      const prompt=$("generation-prompt").value.trim();
      const projectId=$("generation-project").value;
      if(!projectId) throw new Error("Primero selecciona el proyecto donde guardar la imagen.");
      if(prompt.length<8) throw new Error("Describe la imagen con al menos 8 caracteres.");
      if(prompt.length>1800) throw new Error("El texto es demasiado largo. Usa máximo 1,800 caracteres.");

      button.disabled=true;
      button.textContent="Generando imagen...";
      message("generation-message","Generación gratuita con FLUX. No se utilizará ningún proveedor de pago.");
      const sb=client();
      const {data:{session},error:sessionError}=await sb.auth.getSession();
      if(sessionError) throw sessionError;
      if(!session?.access_token) throw new Error("Tu sesión expiró. Cierra sesión e inicia nuevamente.");

      const response=await fetch("/api/jobs",{
        method:"POST",
        headers:{
          "content-type":"application/json",
          "authorization":`Bearer ${session.access_token}`
        },
        body:JSON.stringify({action:"generate_image",projectId,prompt:window.VSASceneEngine?.buildImagePrompt({title:"Imagen solicitada",description:prompt})||prompt})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok || !result.ok) throw new Error(result.message||(result.error==="free_quota_exhausted"?"Se agotó la cuota gratuita diaria.":"No se pudo generar la imagen."));

      const dataUrl=`data:image/png;base64,${result.image}`;
      $("generation-preview").src=dataUrl;
      $("generation-preview-wrap").classList.remove("hidden");

      const binary=atob(result.image);
      const bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
      const blob=new Blob([bytes],{type:"image/png"});
      const {data:{user},error:userError}=await sb.auth.getUser();
      if(userError) throw userError;
      const path=`${user.id}/${projectId}/generated-${Date.now()}.png`;
      const {error:uploadError}=await sb.storage.from("video-assets").upload(path,blob,{contentType:"image/png",upsert:false});
      if(uploadError) throw uploadError;
      const {error:dbError}=await sb.from("project_assets").insert({
        project_id:projectId,user_id:user.id,storage_path:path,
        file_name:path.split("/").pop(),mime_type:"image/png",asset_type:"image"
      });
      if(dbError){ await sb.storage.from("video-assets").remove([path]); throw dbError; }
      await loadAssets();
      message("generation-message","¡Imagen generada y guardada en el almacenamiento privado de tu proyecto!");
    } catch(e) {
      message("generation-message",e.message,true);
    } finally {
      button.disabled=false;
      button.textContent="Generar imagen con IA";
    }
  }

  async function loadWanJobs() {
    const root=$("wan-queue-list");
    if(!root)return;
    try{
      const {data:{session},error}=await client().auth.getSession();
      if(error)throw error;
      if(!session?.access_token)throw new Error("Inicia sesión para consultar tus trabajos.");
      const response=await fetch("/api/jobs",{headers:{Accept:"application/json",Authorization:"Bearer "+session.access_token}});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(data.message||"No se pudo consultar la cola.");
      root.replaceChildren();
      if(!data.jobs?.length){const empty=document.createElement("p");empty.className="muted";empty.textContent="Todavía no hay trabajos en la cola Wan 2.2.";root.append(empty);return;}
      for(const job of data.jobs){
        const card=document.createElement("article");card.className="project-card";
        const title=document.createElement("h4");title.textContent=(projectNames.get(job.project_id)||"Proyecto")+" · "+job.duration_seconds+" s";
        const state=document.createElement("p");state.textContent=({queued:"En espera de GPU",processing:"Generando video",assembling:"Ensamblando MP4",cancelling:"Deteniendo proceso…",completed:"Video terminado",failed:"Error de generación",cancelled:"Cancelado"}[job.status]||job.status)+" · "+Number(job.progress||0)+"%";
        const detail=document.createElement("small");detail.textContent="Segmentos: "+Number(job.completed_segments||0)+"/"+Number(job.total_segments||0)+" · "+new Date(job.created_at).toLocaleString("es-MX");
        card.append(title,state,detail);
        if(job.error_message){const error=document.createElement("p");error.className="message";error.textContent=job.error_message;card.append(error);}
        if(job.download_url&&job.status==="completed"){const link=document.createElement("a");link.href=job.download_url;link.target="_blank";link.rel="noopener";link.textContent="Abrir video MP4";card.append(link);}
        const active=["queued","processing","assembling","cancelling"].includes(job.status);
        if(["queued","processing","assembling"].includes(job.status)){
          const cancelButton=document.createElement("button");
          cancelButton.type="button";cancelButton.className="danger-button";
          cancelButton.textContent=job.status==="queued"?"Cancelar trabajo":"Detener proceso";
          cancelButton.addEventListener("click",()=>cancelWanJob(job,cancelButton));
          card.append(cancelButton);
        } else if(job.status==="cancelling"){
          const waiting=document.createElement("button");
          waiting.type="button";waiting.className="secondary";waiting.textContent="Confirmando cancelación…";waiting.disabled=true;
          card.append(waiting);
        }
        const removeButton=document.createElement("button");
        removeButton.type="button";removeButton.className="danger-button";removeButton.textContent="Eliminar trabajo";
        removeButton.disabled=active;
        removeButton.title=active?"No se puede eliminar mientras el trabajo esté en espera o proceso.":"Eliminar este trabajo";
        removeButton.addEventListener("click",()=>deleteWanJob(job,removeButton));
        card.append(removeButton);
        root.append(card);
      }
    }catch(error){root.replaceChildren();const note=document.createElement("p");note.className="message";note.textContent=error.message;root.append(note);}
  }
  async function cancelWanJob(job,button) {
    if(!job?.id)return;
    const queued=job.status==="queued";
    const question=queued
      ?"¿Cancelar este trabajo antes de que la GPU lo inicie?"
      :"¿Detener la generación? Kaggle interrumpirá Wan 2.2 y confirmará cuando sea seguro eliminar el trabajo.";
    if(!window.confirm(question))return;
    button.disabled=true;
    try{
      const {data:{session},error}=await client().auth.getSession();
      if(error)throw error;
      if(!session?.access_token)throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
      const response=await fetch("/api/jobs",{
        method:"DELETE",
        headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},
        body:JSON.stringify({id:job.id,action:"cancel"})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)throw new Error(result.message||"No se pudo cancelar el trabajo.");
      await loadWanJobs();
      message("wan-queue-message",result.message||"Solicitud de cancelación registrada.");
    }catch(error){
      message("wan-queue-message",error.message,true);
      button.disabled=false;
    }
  }

  async function deleteWanJob(job,button) {
    if(!job?.id)return;
    if(["processing","assembling"].includes(job.status)){
      alert("Este trabajo está siendo procesado. Espera a que termine antes de eliminarlo.");
      return;
    }
    if(!window.confirm("¿Eliminar definitivamente este trabajo"+(job.output_path?" y su video terminado":"")+"?"))return;
    button.disabled=true;
    try{
      const {data:{session},error}=await client().auth.getSession();
      if(error)throw error;
      if(!session?.access_token)throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
      const response=await fetch("/api/jobs",{
        method:"DELETE",
        headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},
        body:JSON.stringify({id:job.id})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)throw new Error(result.message||"No se pudo eliminar el trabajo.");
      await loadWanJobs();
      message("wan-queue-message","Trabajo eliminado correctamente.");
    }catch(error){
      alert(error.message);
      button.disabled=false;
    }
  }
  async function clearFinishedWanJobs() {
    const clearButton=$("wan-queue-clear");
    if(!clearButton)return;
    if(!window.confirm("Se eliminarán todos los trabajos terminados, fallidos y cancelados, incluidos sus videos terminados. Los trabajos en espera y en proceso se conservarán. ¿Continuar?"))return;
    clearButton.disabled=true;
    try{
      const {data:{session},error}=await client().auth.getSession();
      if(error)throw error;
      if(!session?.access_token)throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
      const response=await fetch("/api/jobs",{headers:{Accept:"application/json",Authorization:"Bearer "+session.access_token}});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.ok)throw new Error(data.message||"No se pudo consultar la cola.");
      const finished=(data.jobs||[]).filter(job=>["completed","failed","cancelled"].includes(job.status));
      let removed=0;
      for(const job of finished){
        const result=await fetch("/api/jobs",{
          method:"DELETE",
          headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},
          body:JSON.stringify({id:job.id})
        });
        const payload=await result.json().catch(()=>({}));
        if(!result.ok||!payload.ok)throw new Error("Se eliminaron "+removed+" trabajos; el siguiente no pudo borrarse: "+(payload.message||job.id));
        removed++;
      }
      await loadWanJobs();
      message("wan-queue-message","Limpieza terminada: "+removed+" trabajos eliminados.");
    }catch(error){
      message("wan-queue-message",error.message,true);
      await loadWanJobs();
    }finally{
      clearButton.disabled=false;
    }
  }


  const voicePreviewSamples = [
    {id:"mx-dalia",name:"Voz 1 · Dalia",voice:"es-MX-DaliaNeural",label:"Femenina · cálida y expresiva",text:"Me alegra que hayan venido. Sé que han trabajado mucho y quiero ayudarlos a conseguir esa oportunidad."},
    {id:"mx-jorge",name:"Voz 2 · Jorge",voice:"es-MX-JorgeNeural",label:"Masculina · natural y conversacional",text:"Hermanos, escúchenme. No va a ser fácil conseguir ese automóvil, pero si trabajamos juntos, lo vamos a lograr."},
    {id:"mx-beatriz",name:"Voz 3 · Beatriz",voice:"es-MX-BeatrizNeural",label:"Femenina · clara y serena",text:"Antes de tomar una decisión, necesitamos conocer los riesgos y pensar con calma en lo que puede ocurrir."},
    {id:"mx-candela",name:"Voz 4 · Candela",voice:"es-MX-CandelaNeural",label:"Femenina · animada",text:"¡Qué emoción! Nunca había visto a alguien prepararse con tantas ganas para una carrera tan importante."},
    {id:"mx-carlota",name:"Voz 5 · Carlota",voice:"es-MX-CarlotaNeural",label:"Femenina · cercana",text:"No se preocupen. Si permanecemos unidos, encontraremos una solución para salir adelante."},
    {id:"mx-cecilio",name:"Voz 6 · Cecilio",voice:"es-MX-CecilioNeural",label:"Masculina · adulta y firme",text:"La carrera comienza al amanecer. Revisemos el motor, preparemos las herramientas y salgamos con tiempo."},
    {id:"mx-gerardo",name:"Voz 7 · Gerardo",voice:"es-MX-GerardoNeural",label:"Masculina · grave y decidida",text:"No pienso rendirme ahora. Hemos avanzado demasiado para dejar nuestro sueño a mitad del camino."},
    {id:"mx-larissa",name:"Voz 8 · Larissa",voice:"es-MX-LarissaNeural",label:"Femenina · juvenil",text:"¡Eso es! Yo estoy lista desde ahora. Denme una oportunidad y verán de lo que somos capaces."},
    {id:"mx-liberto",name:"Voz 9 · Liberto",voice:"es-MX-LibertoNeural",label:"Masculina · juvenil y enérgica",text:"¡Vamos! El público ya está llegando y tenemos que demostrar todo lo que hemos practicado."},
    {id:"mx-luciano",name:"Voz 10 · Luciano",voice:"es-MX-LucianoNeural",label:"Masculina · reflexiva",text:"Esperen un momento. Primero hagamos las cuentas y organicemos el plan. Así tendremos más posibilidades."},
    {id:"mx-marina",name:"Voz 11 · Marina",voice:"es-MX-MarinaNeural",label:"Femenina · juvenil",text:"A veces el camino parece difícil, pero cada pequeño esfuerzo nos acerca un poco más a lo que soñamos."},
    {id:"mx-nuria",name:"Voz 12 · Nuria",voice:"es-MX-NuriaNeural",label:"Femenina · madura y tranquila",text:"Lo importante es que cada uno encuentre su lugar y aporte lo mejor de sí mismo al equipo."},
    {id:"mx-pelayo",name:"Voz 13 · Pelayo",voice:"es-MX-PelayoNeural",label:"Masculina · cálida",text:"El motor está listo. Ahora solo falta concentrarnos, mantener la calma y disfrutar de la competencia."},
    {id:"mx-renata",name:"Voz 14 · Renata",voice:"es-MX-RenataNeural",label:"Femenina · suave y reflexiva",text:"Quiero que recuerden este momento. Todo lo que estamos construyendo comenzó con una pequeña idea."},
    {id:"mx-yago",name:"Voz 15 · Yago",voice:"es-MX-YagoNeural",label:"Masculina · enérgica",text:"¡Que se escuche el rugido del motor! Hoy vamos a darlo todo hasta cruzar la línea de meta."}
  ];
  async function generateVoicePreviews() {
    const button=$("voice-preview-generate");
    const root=$("voice-preview-results");
    try {
      button.disabled=true;
      button.textContent="Generando las 15 muestras…";
      root.replaceChildren();
      message("voice-preview-message","Solicitando quince voces neuronales mexicanas de Azure Speech F0. Se generan una por una para respetar el límite de solicitudes; no se publican ni se asignan a personajes.");
      const {data:{session},error}=await client().auth.getSession();
      if(error)throw error;
      if(!session?.access_token)throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
      const response=await fetch("/api/jobs",{
        method:"POST",
        headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},
        body:JSON.stringify({action:"generate_azure_speech_batch",dialogues:voicePreviewSamples.map((sample,index)=>({
          index,segmentId:sample.id,voice:sample.voice,text:sample.text
        }))})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)throw new Error(result.message||result.error||"No se pudieron generar las muestras.");
      const byId=new Map((result.audio||[]).map(item=>[item.segmentId,item.audio]));
      for(const sample of voicePreviewSamples){
        const encoded=byId.get(sample.id);
        if(!encoded)throw new Error("El motor no devolvió la muestra de "+sample.name+".");
        const binary=atob(encoded),bytes=new Uint8Array(binary.length);
        for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
        const url=URL.createObjectURL(new Blob([bytes],{type:"audio/mpeg"}));
        const card=document.createElement("article");
        card.className="project-card";
        card.style.cssText="padding:16px;margin:12px 0";
        const title=document.createElement("h4");title.textContent=sample.name;
        const label=document.createElement("p");label.className="muted";label.textContent=sample.label+" · Motor: "+sample.voice;
        const dialogue=document.createElement("p");dialogue.textContent="“"+sample.text+"”";
        const player=document.createElement("audio");player.controls=true;player.preload="metadata";player.src=url;player.style.cssText="display:block;width:100%;margin-top:10px";
        card.append(title,label,dialogue,player);root.append(card);
      }
      message("voice-preview-message","Las quince muestras reales de Azure Speech están listas. Reprodúcelas y decide cuáles apruebas. Ninguna se ha asignado a personajes ni se ha subido a producción.");
    }catch(error){
      message("voice-preview-message",error.message,true);
    }finally{
      button.disabled=false;
      button.textContent="Generar las 15 muestras de voz";
    }
  }

  async function submitWanJob() {
    const button=$("wan-queue-submit");
    try{
      const prompt=$("video-story")?.value.trim()||"";
      const projectId=$("generation-project")?.value||"";
      const durationSeconds=Number($("production-film-duration")?.value||1200);
      let segmentSeconds=Number($("production-segment-duration")?.value||30);
      if(!Number.isInteger(durationSeconds)||durationSeconds<15||durationSeconds>1200)throw new Error("Selecciona una duración entre 15 segundos y 20 minutos.");
      if(![15,30].includes(segmentSeconds)||durationSeconds%segmentSeconds!==0)throw new Error("La duración seleccionada debe dividirse exactamente en segmentos de 15 o 30 segundos.");
      if(prompt.length<30)throw new Error("Escribe o pega una historia de al menos 30 caracteres en el campo Guion o historia.");
      if(!projectId)throw new Error("Selecciona primero el proyecto destino en Genera imágenes con inteligencia artificial.");
      button.disabled=true;
      message("wan-queue-message","Validando sesión y registrando el trabajo en Supabase…");
      const {data:{session},error}=await client().auth.getSession();
      if(error)throw error;
      if(!session?.access_token)throw new Error("Tu sesión expiró. Inicia sesión nuevamente.");
      const response=await fetch("/api/jobs",{
        method:"POST",
        headers:{"content-type":"application/json",authorization:"Bearer "+session.access_token},
        body:JSON.stringify({
          projectId,prompt,durationSeconds,segmentSeconds,
          resolution:"720p",style:"Realista cinematográfico",voice:"female",inputMode:"text"
        })
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok){const detail=result.details?("\nDetalle técnico: "+JSON.stringify(result.details)): "";throw new Error((result.message||result.error||"No se pudo registrar el trabajo.")+detail);}
      const durationLabel=durationSeconds<60?durationSeconds+" segundos":Math.floor(durationSeconds/60)+" minuto(s)"+(durationSeconds%60?" y "+(durationSeconds%60)+" segundos":"");
      const confirmation="Trabajo de "+durationLabel+" registrado correctamente. ID: "+result.job.id+". Estado: en espera de GPU. El notebook Kaggle debe estar activo para procesarlo.";
      message("wan-queue-message",confirmation);
      message("video-message",confirmation);
      await loadWanJobs();
    }catch(error){
      message("wan-queue-message",error.message,true);
      message("video-message",error.message,true);
    }
    finally{button.disabled=false;}
  }

  $("login-btn").addEventListener("click",()=>auth("login"));
  $("signup-btn").addEventListener("click",()=>auth("signup"));
  $("create-project-btn").addEventListener("click",createProject);
  $("upload-btn").addEventListener("click",uploadAsset);
  $("generate-image-btn").addEventListener("click",generateImage);
  $("refresh-btn").addEventListener("click",loadProjects);
  $("diagnose-btn")?.addEventListener("click",diagnoseConnection);
  $("wan-queue-submit")?.addEventListener("click",submitWanJob);
  $("voice-preview-generate")?.addEventListener("click",generateVoicePreviews);
  $("wan-queue-refresh")?.addEventListener("click",loadWanJobs);
  $("wan-queue-clear")?.addEventListener("click",clearFinishedWanJobs);
  $("wan-open-kaggle")?.addEventListener("click",()=>{
    window.open("https://www.kaggle.com/code","_blank","noopener,noreferrer");
    message("wan-queue-message","Kaggle se abrió en otra pestaña. Abre tu notebook privado de Wan 2.2 y pulsa Ejecutar todo para iniciar el trabajador con GPU.");
  });
  window.addEventListener("vsa-video-created",async(event)=>{
    try{
      const projectId=$("generation-project").value;
      if(!projectId) throw new Error("Selecciona un proyecto para guardar el video.");
      const {data:{user},error:userError}=await client().auth.getUser();
      if(userError) throw userError;
      if(!user) throw new Error("Inicia sesión nuevamente para guardar el video.");
      const {blob,extension,mime}=event.detail||{};
      if(!blob||!extension||!mime) throw new Error("No se recibió el archivo de video.");
      const fileName="video-"+Date.now()+"."+extension;
      const path=user.id+"/"+projectId+"/"+fileName;
      const {error:uploadError}=await client().storage.from("video-assets").upload(path,blob,{contentType:mime,upsert:false});
      if(uploadError) throw uploadError;
      const {error:dbError}=await client().from("project_assets").insert({
        project_id:projectId,user_id:user.id,storage_path:path,file_name:fileName,
        mime_type:mime,asset_type:"video"
      });
      if(dbError){
        await client().storage.from("video-assets").remove([path]);
        throw dbError;
      }
      await loadAssets();
      message("video-message","¡Video creado y guardado en la biblioteca privada de tu proyecto!");
    }catch(error){
      message("video-message","El video está creado y puedes descargarlo, pero no se pudo guardar en la biblioteca: "+error.message,true);
    }
  });
  $("logout-btn").addEventListener("click",async()=>{
    const button=$("logout-btn");
    button.disabled=true;
    try {
      const {error}=await client().auth.signOut();
      if(error) throw error;
      $("app-panel").classList.add("hidden");
      $("auth-panel").classList.remove("hidden");
      message("auth-message","Sesión cerrada correctamente.");
    } catch(error) {
      message("project-message","No se pudo cerrar la sesión: "+error.message,true);
    } finally {
      button.disabled=false;
    }
  });
  $("supabase-url").value=localStorage.getItem("vsa_url")||"";
  $("supabase-key").value=localStorage.getItem("vsa_key")||"";
  try {
    if($("supabase-url").value && $("supabase-key").value) {
      connect();
      client().auth.getSession().then(({data})=>{if(data.session) showApp(data.session.user);});
    }
  } catch(e) {
    // Show a safe diagnostic without logging or exposing credentials.
    message("auth-message",e.message,true);
  }
})();
// Voice preview audition: three distinct Spanish Aura-2 samples, approval before production.
