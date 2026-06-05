/**
 * admin-merge-roster.js — TEMPORAL, borrar tras limpiar prim6
 */
const { createClient } = require("@supabase/supabase-js");
const TEACHER_PW = process.env.TEACHER_PASSWORD || "yoshipotosucio";
const CORS = { "Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json" };
let _db=null;
function db(){if(!_db)_db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);return _db;}
function norm(s){return s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\s+/g," ").trim();}

async function mergeInto(fromId,toId,fromEvals,toEvals){
  const d=db();
  const winSes=new Set(toEvals.map(e=>e.sesion));
  for(const ev of fromEvals){
    if(winSes.has(ev.sesion)){await d.from("evaluaciones").delete().eq("id",ev.id);}
    else{await d.from("evaluaciones").update({alumno_id:toId}).eq("id",ev.id);winSes.add(ev.sesion);}
  }
  await d.from("bonuses").update({alumno_id:toId}).eq("alumno_id",fromId);
  await d.from("alumnos").delete().eq("id",fromId);
}

exports.handler = async (event) => {
  if(event.httpMethod==="OPTIONS") return {statusCode:204,headers:CORS,body:""};
  let body={};try{body=JSON.parse(event.body||"{}");}catch{}
  if(body.pw!==TEACHER_PW) return {statusCode:401,headers:CORS,body:'{"error":"Unauthorized"}'};

  if(body.action==="full-clean"){
    const {grado,canonical}=body;
    const d=db();
    const {data:alumnos}=await d.from("alumnos").select("id,nombre,evaluaciones(id,sesion,score),bonuses(id)").eq("grado",grado);
    const all=[...(alumnos||[])];
    const log=[];let merged=0,deleted=0,renamed=0;
    const usedIds=new Set();

    for(const canonName of canonical){
      const normCan=norm(canonName);
      const normWords=normCan.split(" ");
      const matches=all.filter(a=>{
        if(usedIds.has(a.id))return false;
        const normA=norm(a.nombre);
        if(normA===normCan)return true;
        const wordsA=normA.split(" ");
        const shorter=wordsA.length<=normWords.length?wordsA:normWords;
        const longer=wordsA.length<=normWords.length?normWords:wordsA;
        const mc=shorter.filter(t=>longer.includes(t)).length;
        return mc>=Math.min(2,shorter.length)&&mc/shorter.length>=0.5;
      });
      if(matches.length===0){log.push(`⚠ Sin match: "${canonName}"`);continue;}
      matches.sort((a,b)=>(b.evaluaciones||[]).length-(a.evaluaciones||[]).length);
      const winner=matches[0];usedIds.add(winner.id);
      for(const dup of matches.slice(1)){
        usedIds.add(dup.id);
        const dupEvals=dup.evaluaciones||[];
        await mergeInto(dup.id,winner.id,dupEvals,winner.evaluaciones||[]);
        const winSes=new Set((winner.evaluaciones||[]).map(e=>e.sesion));
        for(const ev of dupEvals){if(!winSes.has(ev.sesion)){winner.evaluaciones.push(ev);winSes.add(ev.sesion);}}
        log.push(`🗑 Fusionado "${dup.nombre}" (${dupEvals.length} evals) → "${canonName}"`);
        merged+=dupEvals.length;deleted++;
      }
      if(norm(winner.nombre)!==normCan){
        await d.from("alumnos").update({nombre:canonName}).eq("id",winner.id);
        log.push(`✏ "${winner.nombre}" → "${canonName}" (${(winner.evaluaciones||[]).length} evals)`);renamed++;
      } else {
        log.push(`✓ OK: "${winner.nombre}" (${(winner.evaluaciones||[]).length} evals)`);
      }
    }
    const orphans=all.filter(a=>!usedIds.has(a.id));
    for(const o of orphans){
      await d.from("evaluaciones").delete().eq("alumno_id",o.id);
      await d.from("bonuses").delete().eq("alumno_id",o.id);
      await d.from("alumnos").delete().eq("id",o.id);
      log.push(`🗑 Huérfano eliminado: "${o.nombre}" (${(o.evaluaciones||[]).length} evals)`);deleted++;
    }
    return {statusCode:200,headers:CORS,body:JSON.stringify({ok:true,grado,stats:{renamed,deleted,merged},log})};
  }
  return {statusCode:400,headers:CORS,body:'{"error":"action required"}'};
};
