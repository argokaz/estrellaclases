/* Plan excepcional versionado; no reemplaza los aplazamientos guardados por la profesora. */
(function(root, factory){
  const plan = factory();
  if(typeof module === 'object' && module.exports) module.exports = plan;
  else root.SCHOOL_CALENDAR_PLAN = plan;
})(typeof window === 'undefined' ? globalThis : window, function(){
  const shifts = [
    ...['prim6','sec2a','sec3','sec5'].map(grade => ({id:'oct09-2026-'+grade,from:20,until:21,weeks:1,grade,reason:'9 de octubre sin clases; recuperación integrada el 16 de octubre',ts:1790899200000})),
    {id:'oct09-2026-sec2b',from:19,until:21,weeks:1,grade:'sec2b',reason:'2.º B grabó video; suspensión del 9 de octubre. Recuperación integrada el 16',ts:1790899200000},
    {id:'oct09-2026-sec4',from:19,until:20,weeks:1,grade:'sec4',reason:'9 de octubre sin clases; prototipo y validación juntos el 16 de octubre',ts:1790899200000},
  ];
  const merged = {prim6:{21:20},sec2a:{21:20},sec2b:{19:20,21:20},sec3:{21:20},sec4:{20:19,27:26},sec5:{21:20}};
  const lessons = {
    prim6:{session:20,sources:[20,21],title:'Encuesta y mensaje para compartirla',tools:'Forms / Docs',act:'Crear una encuesta breve y redactar su invitación',evidence:'Encuesta + mensaje formal'},
    sec2a:{session:20,sources:[20,21],title:'Información verificada en una página simple',tools:'IA / Docs / Sites',act:'Verificar una afirmación y publicar una página mínima',evidence:'Página publicada con fuente y fecha'},
    sec2b:{session:20,sources:[19,20,21],title:'Revisar, verificar y publicar una página simple',tools:'IA / Docs / Sites',act:'Revisar un texto propio, verificarlo y publicarlo',evidence:'Página publicada + evidencia de verificación'},
    sec3:{session:20,sources:[20,21],title:'Editar video sin manipular la información',tools:'CapCut / Docs',act:'Editar un fragmento y documentar su contexto',evidence:'Video breve + ficha de verificación'},
    sec4:{session:19,sources:[19,20],title:'Prototipo y validación con evidencia',tools:'Slides / Forms / Docs',act:'Construir un recorrido mínimo y probar una hipótesis',evidence:'Prototipo + registro de validación'},
    sec5:{session:20,sources:[20,21],title:'Del diseño al primer recorrido funcional',tools:'Canva / Sites / herramienta elegida',act:'Diseñar y producir un recorrido mínimo completo',evidence:'Primer avance funcional + bitácora'},
  };
  function combine(saved){
    const byId = new Map((Array.isArray(saved)?saved:[]).map(s=>[s.id,s]));
    shifts.forEach(s=>byId.set(s.id,s));
    return [...byId.values()];
  }
  return {version:'20261002.1',noClassDates:['2026-10-09'],shifts,merged,lessons,combine};
});
