import type {Choice} from './key';
export type Institute={id:string;name:string;slug:string};
export type TestRecord={
 id:string;institute_id:string;title:string;sheet_test_number:number;
 question_count:number;status:'draft'|'published';answer_key:Choice[];
 correct_marks:number;wrong_marks:number;created_at:string;
};
