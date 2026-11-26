'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
type Question={topic:string;question:string;choices:[string,string,string,string];answer:number;explanation:string};
const questions:Question[]=[
 {topic:'Polity',question:'Which part of the Constitution of India contains the Fundamental Rights?',choices:['Part II','Part III','Part IV','Part V'],answer:1,explanation:'Fundamental Rights are laid out in Part III, Articles 12–35.'},
 {topic:'Geography',question:'Which Indian river is popularly called the Dakshin Ganga?',choices:['Godavari','Krishna','Mahanadi','Kaveri'],answer:0,explanation:'Godavari is often referred to as Dakshin Ganga.'},
 {topic:'Environment',question:'What does the term biodiversity refer to?',choices:['Only plant species','Variety of life at genetic, species and ecosystem levels','Atmospheric gases','Annual rainfall variation'],answer:1,explanation:'Biodiversity includes genetic, species and ecosystem diversity.'},
 {topic:'Economy',question:'Which institution primarily conducts monetary policy in India?',choices:['NITI Aayog','SEBI','Reserve Bank of India','Finance Commission'],answer:2,explanation:'The RBI carries out monetary policy under its statutory framework.'},
 {topic:'History',question:'Who presided over the Indian National Congress session at Lahore in 1929?',choices:['Mahatma Gandhi','Jawaharlal Nehru','Subhas Chandra Bose','Sardar Vallabhbhai Patel'],answer:1,explanation:'Jawaharlal Nehru presided over the 1929 Lahore session that adopted Purna Swaraj as the goal.'},
 {topic:'Science',question:'Which device is commonly used to measure atmospheric pressure?',choices:['Hygrometer','Anemometer','Barometer','Seismograph'],answer:2,explanation:'A barometer measures atmospheric pressure.'},
 {topic:'Polity',question:'The Directive Principles of State Policy are contained in which Part of the Constitution?',choices:['Part III','Part IV','Part IVA','Part VI'],answer:1,explanation:'The Directive Principles appear in Part IV of the Constitution.'},
 {topic:'Geography',question:'The Tropic of Cancer lies approximately at what latitude?',choices:['0°','23.5° N','23.5° S','66.5° N'],answer:1,explanation:'The Tropic of Cancer is approximately 23°26′ north latitude.'}
];
const STORAGE='omrlabs-online-practice-v1';
export default function PracticeTest(){
 const [answers,setAnswers]=useState<Record<number,number>>({});
 const [submitted,setSubmitted]=useState(false);
 const [ready,setReady]=useState(false);
 useEffect(()=>{try{const raw=localStorage.getItem(STORAGE);if(raw){const old=JSON.parse(raw);
  if(old&&typeof old.answers==='object')setAnswers(old.answers);
  if(old?.submitted===true)setSubmitted(true);}}catch{}setReady(true);},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem(STORAGE,JSON.stringify({answers,submitted}));}catch{}},[answers,submitted,ready]);
 const done=Object.keys(answers).length,correct=questions.filter((q,i)=>answers[i]===q.answer).length,
 wrong=questions.filter((q,i)=>answers[i]!==undefined&&answers[i]!==q.answer).length;
 const score=(correct*2-wrong*0.66).toFixed(2);
 const reset=()=>{if(!window.confirm('Restart the practice test and clear your responses?'))return;
  setAnswers({});setSubmitted(false);};
 return <div className="dashboard practicePage">
  <Link className="backLink" href="/sample">← Back to demo analytics</Link>
  <div className="dashTop"><div><span className="miniEyebrow">OMRLABS · ONLINE TEST SERIES PROTOTYPE</span>
   <h1>Practice Test · General Studies</h1>
   <p>8 original sample MCQs · +2 correct · −0.66 incorrect · 0 unanswered</p></div>
   <span className="pill">Browser-local prototype</span></div>
  <div className="notice">This is an offline-style demonstration of the future online examination system.
   Answers are stored only in this browser. There is no candidate authentication, proctoring,
   secure question delivery or Neon submission for this prototype.</div>
  <div className="sampleStats">
   <div className="sampleMetric"><span>Questions</span><strong>{questions.length}</strong></div>
   <div className="sampleMetric"><span>Attempted</span><strong>{done}</strong></div>
   <div className="sampleMetric"><span>Unanswered</span><strong>{questions.length-done}</strong></div>
   <div className="sampleMetric"><span>Status</span><strong>{submitted?'Submitted':'In progress'}</strong></div>
  </div>
  {submitted&&<div className="scoreHero practiceScore"><span>YOUR PRACTICE RESULT</span>
   <strong>{score} <small>/ {questions.length*2}</small></strong>
   <p>{correct} correct · {wrong} incorrect · {questions.length-done} blank</p>
  </div>}
  <div className="practiceList">{questions.map((q,i)=><section key={i} className="surface practiceQuestion">
   <div className="sampleQuestionHead"><strong>Q{i+1} · {q.topic}</strong>
    {submitted&&<span>{answers[i]===undefined?'Not attempted':answers[i]===q.answer?'Correct ✓':'Incorrect'}</span>}</div>
   <h2>{q.question}</h2>
   <div className="practiceChoices">{q.choices.map((value,j)=><button type="button"
    key={j} disabled={submitted} aria-pressed={answers[i]===j}
    className={'practiceChoice'+(answers[i]===j?' isSelected':'')+(submitted&&j===q.answer?' isCorrect':'')}
    onClick={()=>setAnswers(old=>({...old,[i]:j}))}>
    <strong>{'ABCD'[j]}</strong><span>{value}</span></button>)}</div>
   {submitted&&<p className="practiceExplanation"><strong>Answer: {'ABCD'[q.answer]}.</strong> {q.explanation}</p>}
  </section>)}</div>
  <div className="editorBottom practiceSubmit">
   <div><strong>{submitted?'Test submitted':'Ready to submit?'}</strong>
    <p>{submitted?'Review the answer explanations above.':done+' of '+questions.length+' questions attempted.'}</p></div>
   <div className="toolActions">
    <button className="button secondary" onClick={reset}>Restart</button>
    {!submitted&&<button className="button primary" onClick={()=>{if(window.confirm('Submit and reveal the answers?'))setSubmitted(true);}}>Submit practice test ↗</button>}
   </div>
  </div>
  <div className="notice"><strong>Planned for production:</strong> institute-authored test series, scheduled papers,
  server-controlled question delivery, timed submissions, randomization, versioned answer keys,
  reliable attempt persistence and shared analytics with scanned OMR results.
  AI-assisted question drafting will require source citations and human approval before publication.</div>
 </div>;
}
