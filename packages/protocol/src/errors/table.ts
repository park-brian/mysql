// GENERATED FILE — do not edit by hand. Run `npm run gen:errors`.
//
// M1.6 / D-14: generated from MySQL's own error source rather than
// transcribed. D-29: facts only — codes, SQLSTATEs and strict membership. The
// English message templates are not reproduced; ground rule 7 keeps this
// repository free of MySQL source, which is GPLv2 to our MIT.
//
// Source:  mysql/mysql-server@e174239c share/messages_to_clients.txt
// SHA-256: 3ddd9dbba5d4c76101af4effb91e449027c2ca1a56242e4891736280808fd762
// Entries: 2132

/** The upstream file this table was generated from, for re-verification. */
export const ERROR_TABLE_SOURCE = 'mysql/mysql-server@e174239c share/messages_to_clients.txt'

/** SHA-256 of that file. CI regenerates and diffs; a change here is a real change. */
export const ERROR_TABLE_SOURCE_SHA256 =
  '3ddd9dbba5d4c76101af4effb91e449027c2ca1a56242e4891736280808fd762'

/** Number of entries, including OBSOLETE_* symbols, which still consume codes. */
export const ERROR_TABLE_SIZE = 2132

/** The pinned source of strict warning-promotion membership. Facts only. */
export const STRICT_ERROR_SOURCE = 'mysql/mysql-server@e174239c sql/error_handler.cc'
export const STRICT_ERROR_SOURCE_SHA256 = '709fff0c6c4f005e9bb95e16c605014a11a1f63764fb897efbf5d8f1fd346fba'

/** Native codes promoted by Strict_error_handler; no eager symbol-table lookup. */
export const STRICT_ERROR_CODES: ReadonlySet<number> = new Set([1292, 1411, 1264, 3752, 1365, 1366, 1265, 3751, 1406, 1048, 1364, 1071, 1423, 1263, 1260, 1441, 6527, 1261, 1262, 3020, 3155, 3156, 1301])

/** Lowercase tokens encode underscore-delimited words in packed symbols. */
export const ERROR_NAME_WORDS = 'ERROR INVALID NOT TABLE NO CANT LH WARN IN GTID WRONG ACCESS ACTIVE AFTER AGGREGATE ALGORITHM ALREADY ALTER AND ANNOTATIONS ANONYMOUS APPLIER ARCHIVE ARGUMENT ATTRIBUTE AUDIT_LOG AUTH AUTO AUTOEXTEND AUTOINC AVAILABLE AVRO BAD BE BEFORE BIG BINLOG BINLOG_UNSAFE BOOST BUFFER BULK BY CACHE CANNOT CAPACITY CARTESIAN CHANGE CHANGED CHANNEL CHANNELS CHARACTER CHARSET CHECK CHECKS CHILD CLAUSE CLIENT CLONE COL COLLATION COLLISION COLUMN COLUMNS COMMAND COMMENT COMMIT COMMUNICATION COMPLETE COMPONENT COMPONENTS COMPRESSION CONCURRENT COND CONDITION CONFIGURATION CONFLICT CONNECTION CONSISTENCY CONSTRAINT CONVERSION CONVERT CORRUPT CORRUPTED COUNT CREATE CREATION CRST CURRENT CURSOR DA DATA DATETIME DECIMAL DEFAULT DEFINED DEFINER DEFINITION DELETE DENIED DEPENDENT DEPRECATED DIFFERENT DISABLE DISABLED DISALLOWED DOES DOESNT DROP DUP DUPLICATE DURING EMPTY ENCRYPTION ENGINE ENTRY ERR EVENT EXCEEDED EXCEEDS EXCEPTION EXCHANGE EXECUTED EXECUTION EXIST EXISTS EXPLAIN EXTERNAL FAIL FAILED FAILURE FEATURE FIELD FIELDS FILE FILEGROUP FILES FILTER FILTERS FK FOR FORBIDDEN FOREIGN FORMAT FOUND FPARSER FRAME FULL FULLTEXT FUNC FUNCTION FUNCTIONAL GENERATED GEOJSON GEOMETRY GLOBAL GRANT GROUP GROUPING GRP GTIDS HANDLE HANDLER HAS HAVE HEADER HEARTBEAT HOST HYPERGRAPH IGNORE IGNORED ILLEGAL IMPLEMENTATION IMPLEMENTED IMPORT INCOMPATIBLE INCONSISTENT INCORRECT INCREMENT INDEX INFER INFO INIT INJECTION INNODB INSERT INSTALL INSTALLED INSTANT INSUFFICIENT INTERRUPTED INTERVAL INTO IS JDV JDV_INVALID JSON KEY KEYRING KEYS LANGUAGE LARGE LATITUDE LENGTH LIBCURL LIMIT LIST LOAD LOADER LOCK LOCKED LOG LOGGING LONG LONGITUDE MALFORMED MANDATORY MANY MASKING MASTER MATCH MAX METADATA MISMATCH MISSING MODE MULTIPLE MUST NAME NATIVE NESTED NET NEXT NON NONEXISTING NONPARTITIONED NOT_ALLOWED NOT_SUPPORTED NULL NUMBER OBJECT OFF ON ONLY OPEN OPERATION OPTION OR ORDER OUT_OF OVERFLOW PACKET PARAM PARAMETER PARAMETERS PARENT PARQUET PARSE PARSER PARSING PART PARTIAL PARTITION PARTITIONING PARTITIONS PASSWORD PATH PERSIST PERSISTED PLUGIN POLICY POSITION PREVENTS PRIMARY PRIVILEGE PROC PROCEDURE PURGE PURGED QUERY RANGE READ READER READONLY REASON RECONNECT RECORD RECOVERY RECURSION RECURSIVE REDO REFERENCE REFERENCED REGEXP REGISTRATION REPLACE REPLICA REPLICATE REPLICATION REPOSITORY REQUIRED REQUIRES RESOURCE ROLE ROLLBACK ROTATE ROTATION ROUTINE ROW RPL RUNNING SAME SCHEMA SECONDARY SECURE SELECT SERVER SERVICE SESSION SET SETTABLE SIGNAL SIZE SKIPPED SLAVE SOURCE SP SPATIAL SPECIFICATION SPECIFIED SQL SRID SRS START STATEMENT STATISTICS STD STMT STOP STORE STORED STRING SUBOBJECT SUBPARTITION SUBQUERY SUCH SWITCH SYNTAX SYSTEM TABLES TABLESPACE TARGET TEMP TEMPORARY TERMINATOR THAN THREAD TIME TIMEOUT TIMESTAMP TO TOO TRANSACTION TRANSACTIONS TRANSFORM TRG TRIGGER TRUNCATED TYPE UDF UNABLE UNEXPECTED UNIQUE UNKNOWN UNLOAD UNSAFE UNSTRUCTURED UNSUPPORTED UNUSED UPDATE USE USED USER USING UUID VALIDATION VALUE VALUES VAR VARIABLE VARIABLES VECTOR VERSION VIEW VIRTUAL WARNING WARN_DEPRECATED WHEN WINDOW WITH WITHOUT WRITE'

/**
 * `@errno` starts a sequential range; each following entry consumes one code.
 * Comma-delimited entries hold a packed symbol and an optional SQLSTATE.
 * A trailing space represents 42000, the most common nondefault state.
 * Symbols begin with ER_ by default. ? means OBSOLETE_ER_, and ! leaves
 * the symbol prefix empty. Lowercase tokens
 * encode words and frequent adjacent pairs. _ separates raw words and ~ encodes an empty word.
 * The decoder preserves entry order and alias precedence.
 */
export const PACKED_ERROR_TABLE = `@1000,\
?HASHCHK,\
?NISAMCHK,\
e,\
YES,\
fnvps,\
fnvd,\
fnvDB,\
DBnvpj,\
DBospj,\
?DBosoi,\
DBosRMDIR,\
?foips,\
fFINDxyREC,\
fGET_STAT,\
?fGET_WD,\
fsp,\
ftyps,\
pscqc,\
fvjDIR,\
?fwvWD,\
CHECKREAD,\
?DISKqf,\
otsd 23000,\
?atwCLOSE,\
atwvj,\
atwRENAME,\
atwzz,\
pszf,\
?FILSORT_ABORT,\
?FORMcqc,\
GET_ERRNO,\
rdHA,\
sdcqc,\
cFORMps,\
cKEYFILE,\
OLD_KEYFILE,\
tyASvl,\
OUTOFMEMORY HY001,\
udSORTMEMORY HY001,\
?yvEOF,\
CONnua 08004,\
udRESOURCES,\
lvqza 08S01,\
HANDSHAKEa 08S01,\
DBACCESSoja ,\
laoja 28000,\
eDBa 3D000,\
yxCOMa 08S01,\
lvtsa 23000,\
lvDBa ,\
dpja 42S01,\
lvda 42S02,\
tnUNIQa 23000,\
wsSHUTDOWN 08S01,\
lvpqa 42S22,\
kpqzxqp ,\
kqppq ,\
kSUMwr ,\
kzknu 21S01,\
ylstIDENT ,\
otFIELDNAME 42S21,\
otKEYNAME ,\
otoz 23000,\
kpqSPEC ,\
ula ,\
owvh ,\
NONUNIQd ,\
boe ,\
tgPRIsd ,\
ylsxsf ,\
ylsxsdPARTS ,\
ylstsd ,\
sdmyoqcEXITS ,\
BLOBzfASsd ,\
yllyFIELDLENGTH ,\
klqsd ,\
READY,\
?NORMAL_SHUTDOWN,\
?GOTwx,\
SHUTDOWNne,\
FORCING_CLOSE 08S01,\
IPSOCKa 08S01,\
exvrl 42S12,\
kpqTERMINATORS ,\
BLOBSlheTERMINATED ,\
TEXTFILEcREADABLE,\
pspja,\
snrn,\
lgrn,\
kSUBsd,\
fREMOVE_ALLpr ,\
fospqubsd ,\
rrrn,\
zddzf,\
exvyg,\
KILLoja,\
exzzf,\
yllywv,\
eywLOGFILE,\
dcsqpyzz,\
dcsq,\
BLOBfqwoe ,\
kDBti ,\
kdti ,\
yllywr ,\
yxa,\
yxve ,\
kPARAMCOUNTykve ,\
kuiykve,\
yxd 42S02,\
pqxfTWICE ,\
bqpqhze,\
zbEXTENSION ,\
dthqwmz ,\
vopsqf,\
yxmnwv ,\
ylsxxz,\
ylsxpr,\
yllyROWSIZE ,\
STACK_OVERRUN,\
kOUTER_JOINzc ,\
tsmyirl ,\
fFINDyt,\
fINITIALIZEyt,\
ytePATHS,\
ytpj,\
ftyLIBRARY,\
fFIND_DLoz,\
qicof,\
qzrzBLOCKED,\
qzcPRIVILEGED,\
utljzg ,\
uttq ,\
uteta ,\
zdrn,\
fnvyg,\
kzknutwwk 21S01,\
fREOPENd,\
bzeOFts 22004,\
vva ,\
MIX_OFqpqhlhpr ,\
toqo ,\
TABLEACCESSoja ,\
COLUMNACCESSoja ,\
rdqopyd ,\
qokqzubzg ,\
exvd 42S02,\
todqo ,\
tqna ,\
xxa ,\
?UNUSED1,\
?UNUSED2,\
ABORTINGnn 08S01,\
tlufylsh 08S01,\
tlvjaFROM_PIPE 08S01,\
tlFCNTLa 08S01,\
tlPACKETSuduc 08S01,\
tlUNCOMPRESSa 08S01,\
tlvja 08S01,\
tlvjrw 08S01,\
tlatwzz 08S01,\
tlzzrw 08S01,\
ylstxr ,\
dfqtBLOB ,\
dfqtlqrk ,\
?UNUSED3,\
kmyti ,\
ksdmy ,\
kMRGd,\
otyw 23000,\
BLOBsdzysj ,\
vbfqwts ,\
ylsxROWS ,\
wdvbsd ,\
?eRAID_COMPILED,\
zdzysdiSAFEtf,\
sdoqcEXITS ,\
mpexvd ,\
mpcrf ,\
fDO_THISovANym 25000,\
aovnc,\
aovwg,\
aovFLUSH_LOGS,\
?aovCHECKPOINT,\
NEW_ABORTINGnn 08S01,\
?DUMPcrf,\
?FLUSHszlzCLOSED,\
?rlREBUILD,\
xb,\
xbtlvj 08S01,\
xbtlzz 08S01,\
FT_MATCHINGsdcqc,\
spublbym,\
yxxyzn,\
CRASHEDtwUSAGE,\
CRASHEDtwREPAIR,\
ztcnewg,\
TRANSmfqf,\
?xathxo,\
vycwm,\
lvvy,\
nntc,\
vyyg,\
ylsxzgCONNECTIONS ,\
wvCONSTANTStx,\
spWAITyi,\
spdqf,\
vjtxym 25000,\
?osDBzxvjsp,\
?nvDBzxvjsp,\
kARGUMENTS,\
ePERMISSIONyknvzg ,\
?UNIONxziomDIR,\
spDEADLOCK 40001,\
dfqtFT,\
mgADDqa,\
evuwk 23000,\
wkrzvu 23000,\
CONNECTykxb 08S01,\
?vhtwsz,\
azvEXECUTINGna,\
kUSAGE,\
kttOFmziwr 21000,\
fzdzxREADLOCK,\
MIXINGtq,\
otlm,\
zgslREACHED ,\
SPECIFIClaoja ,\
LOCALzn,\
qnzn,\
eoe ,\
kzkpyzm ,\
kyspyzm ,\
zmflwvj,\
fzeuaHERE ,\
trYET ,\
xbFATALaREADINGlz,\
vyrcd,\
rjqnLOCALzm,\
kpxDEF ,\
sdREF_DOctadREF,\
OPERANDmz 21000,\
xue1wk 21000,\
yxxnqu,\
nsHELP_DB,\
?CYCLICvt,\
lqnr,\
rdvt 42S22,\
DERIVEDthqwALIAS ,\
wrREDUCED 01000,\
TABLENAMEtqHERE ,\
trlptf 08004,\
xdfqwts ,\
mwmotd ,\
?xaWASwm,\
?xaWAScwm,\
yllypyUNCOMPRESS,\
ZLIB_Z_MEMa,\
ZLIB_Z_BUFa,\
ZLIB_Zoba,\
CUTzkqpCONCAT,\
hylFEW_RECORDS 01000,\
hylsxRECORDS 01000,\
htsykNOTNULL 22004,\
hobudvi 22003,\
!hobyr 01000,\
hzhOTHERqu,\
fld2COLLATIONS,\
?oszg,\
REVOKE_GRANTS,\
fld3COLLATIONS,\
fldNCOLLATIONS,\
znrzcSTRUCT,\
yxmw,\
vyrcSSL_PARAMS,\
?wsrziwqlptf,\
hpqRESOLVED,\
lvvyUNTILnj,\
teSKIPvy,\
UNTILnjrc,\
ktipyrl ,\
ktipyCATALOG ,\
?hQC_RESIZE,\
lvFTmy,\
yxsdmf,\
hHOSTNAME_WONT_WORK,\
yxSTORAGEoy ,\
zuxx,\
tnUPDATABLEd,\
ppoo,\
uavaxk,\
DUPLICATEDzkiys,\
yrkzk 22007,\
?ylMUCHlqyjCOLS,\
btwzd,\
zbPS,\
GET_ERRMSG,\
GETydERRMSG,\
yxyhZONE,\
hbyj,\
bmnxr,\
hALLOWEDufOVERFLOWED,\
CONFLICTING_DECLARATIONS,\
xcevrnv 2F003,\
xclfpj ,\
xcoqcpi ,\
xcospn,\
xcxppn,\
xcLILABELtd ,\
xcLABEL_REDEFINE ,\
xcLABELtd ,\
xcUNINITzm 01000,\
xcBADSELECT 0A000,\
xcBADRETURN ,\
xcBADSTATEMENT 0A000,\
zdsrolrc ,\
zdsrolTRANSLATED ,\
vhrw 70100,\
xckeOF_ARGS ,\
xcnjtd ,\
xcNORETURN ,\
xcNORETURNEND 2F005,\
xclvnzvh ,\
xclvnzwr ,\
xcnztd ,\
xcnzlfty 24000,\
xcnzcty 24000,\
xcUNDECLAREDzm ,\
xckeOF_FETCH_ARGS,\
xcFETCHeob 02000,\
xcotug ,\
xcotzm ,\
xcotnj ,\
xcotCURS ,\
xcflg,\
xcSUBSELECT_NYI 0A000,\
xntqiSFubyp 0A000,\
xcVARCONDlcCURSHNDLR ,\
xcnzlcqu ,\
xcCASEcqc 20000,\
qdyllyps,\
qdlvqx,\
qdEOFinb,\
qdaiuh,\
qdEOFiyxuh,\
zrepk,\
?FRMyxys,\
ktu,\
NONUPDATEABLEmy,\
?zrwrDERIVEDzc,\
zrwrms,\
zrwrzn,\
zrwrTMPTABLE,\
zrksm,\
hzrMERGE,\
hzrzysd,\
zrb,\
xceosxc,\
?xcGOTOiHNDLR,\
yplfpj,\
ypoqcpi,\
yptwzrubycd,\
ypfmjwk,\
ypexvwkiyp,\
eoepypq,\
DIVISIONmeZERO 22012,\
yrkzkpypq,\
rdzkpyys 22007,\
zrNONUPDmp,\
zrmppn,\
PROCACCESSoja ,\
RELAYsrpm,\
?PASSWDsj,\
yxyblz,\
IOpasrrlvj,\
lzvfPROHIBITED,\
FSEEKpm,\
lzvfFATALpa,\
srize,\
srvfyxpa,\
RELAYsrro,\
eBINARYss,\
RESERVEDxx,\
?WSASpn,\
?DIFF_GROUPSvd,\
?eqppyvd,\
?uczxvd,\
?ssPROHIBIT_CHANGING_OF,\
?epsMAPPING,\
?kMAGIC,\
PSsxug,\
sduo0,\
zrCHECKSUM,\
zrMULTIUPDATE,\
zrerrpqsm,\
zroiMERGEzr,\
mgzg,\
XAER_NOTA XAE04,\
XAER_INVAL XAE05,\
XAER_RMFAIL XAE07,\
XAER_OUTSIDE XAE09,\
XAER_RMERR XAE03,\
XA_RBROLLBACK XA100,\
tovdqo ,\
vdlqqopm,\
vdlqREVOKEpm,\
obylst 22001,\
xclvSQLSTATE ,\
STARTUP,\
snFROM_FIXEDwyROWSykzm,\
fnvzgzxqo ,\
kzkpyys,\
dDEFmk,\
xcotqu ,\
xcczmARG ,\
xceRETSET 0A000,\
fnvqmtu 22003,\
?pnwjBREAKlz,\
mawj,\
lznvwjNEED_SUPER,\
?EXECxnzxtynz,\
xnqvetynz,\
nctqiSFubyp,\
eoepyzrpq,\
xcevq,\
yllySCALE ,\
yllyPRECISION ,\
M_BIGGERyfD ,\
kspOFxyd,\
CONNECTykqaobxb,\
vhtwqaobxb,\
qaobxborpi,\
qaobxrbfnv,\
qaobxrb,\
?fnvFEDERATEDd,\
ypikwo,\
STACK_OVERRUN_NEED_MORE,\
ylstBODY ,\
hfosoeKEYCACHE,\
yllyDISPLAYWIDTH ,\
XAER_DUPID XAE08,\
ocqiue 22008,\
fzdzfdiSFubyp,\
zrPREVENTzd,\
PSevq,\
xcfwvAUTOCOMMIT,\
?svog,\
zrFRMezg,\
zrOTHERzg,\
exvzg,\
FORBIDwomj,\
wkrzvu2 23000,\
evuwk2 23000,\
xclvzmSHADOW ,\
ypeog,\
OLDpsqb,\
xcvqsl,\
?xcvddns,\
xckti ,\
dNEEDS_UPGRADE,\
xceld ,\
tbPREPAREDxnnuREACHED ,\
zrvr,\
tnqqpqzf ,\
dfqtSPKEYS,\
eTRIGGERStwxywo,\
REMOVED_SPACES,\
lsvjpn,\
USERNAME,\
HOSTNAME,\
kxrsj,\
tnINSERTABLEd,\
ADMINkMRGd,\
ylHIGH_LEVEL_OF_NESTINGpywr,\
tiBECOMESow,\
AMBIGUOUSpqTERM,\
qawspj,\
qawsorpi,\
rdHAnvua,\
uqwdzla,\
uqkzla,\
uqMAXVALUEa,\
?uqxta,\
?uqSUBPART_MIXa,\
uqkeuoa,\
uqkeSUBPARTa,\
kEXPRiuqqha,\
?eCONST_EXPRiviubsma,\
pqcqcuoa,\
?smOFprtxiHASHa,\
riuqrna,\
uqqhtqa,\
usthlwofa,\
vicINCREASINGa,\
riysOF_FUNCTIONSa,\
tgDEF_CONSTismuoa,\
uqoza,\
MIXqua,\
uqcofa,\
ylsxusa,\
xta,\
fnvqups,\
BLOBpqiuoqha,\
ywsdNEED_ALLpriPF,\
ePARTSa,\
uqMGMTtwtp,\
qasdtwPARTITIONED,\
osuqtnEXISTENT,\
osLASTuq,\
COALESCEtxtwHASHuq,\
REORG_HASHtxtwwne,\
REORGeuga,\
txtwvismuq,\
ADDuqSUBPARTa,\
ADDuqeNEWuq,\
COALESCEuqeuq,\
REORGuqcpi,\
wntiuq,\
elza,\
CONSECUTIVE_REORGus,\
REORG_OUTSIDEvi,\
uqqipo,\
?uoSTATEa,\
LIMITEDuovi,\
uxrzcLOADED,\
kzk,\
euqpyGIVENzk,\
ptuatxONCE,\
nvptpn,\
osptpn,\
yalqEXTENDa,\
kwytt,\
wyuea,\
lgptpn,\
lzwksspn,\
?lzwkkdDEF,\
?lzwkRBRykSBR,\
pblfpj,\
?pbxppn,\
pboqcpi,\
?pbflg,\
?pbospn,\
pbrxcPOSITIVEubylly,\
pbENDSlxSTARTS,\
pbEXECyhiTHE_PAST,\
?pbtydpn,\
?pbNEITHER_M_EXPR_NOR_M_AT,\
?mvnuortant,\
?mgsnFROMd,\
?pbmgoi,\
?pbCOMPILEa,\
pbwnti,\
?pbobylst,\
osrlpx,\
zuxxzxVER,\
?fzzspsrd,\
fspsrd,\
qaousdOLDzc 23000,\
mvnuortaPLEASEzd,\
?ycdvaxwudRBR,\
xqqivaxwlzqb,\
?NDBfxwlzqb,\
uqeyd,\
uqCONST_DOMAINa,\
uqqirztq,\
?DDLsrazc,\
tsizlLESSyf,\
kuqti,\
fmjTX_CHARACTERISTICS 25001,\
otozAUTOINCREMENT_CASE,\
?pbMODIFY_QUEUEa,\
pbwvzma,\
uqMERGEa,\
?fACTIVATEsr,\
?RBRclt,\
BASE64_DECODEa,\
pbvqpz,\
?EVENTS_DBa,\
txINTEGERS_ALLOWED,\
UNSUPORTEDsroy,\
lvsrxk,\
fRENAMEsrd,\
kPARAMCOUNTyktjFCT ,\
kuiyktjFCT ,\
kuiykxqFCT ,\
tjFCTtimx,\
otozzxsdti 23000,\
lzvfEMFILE,\
pbmgnviTHE_PAST,\
pbmglgiTHE_PAST,\
?xaINCIDENT,\
euqpyGIVENzkSILENT,\
maxk,\
lzFATALa,\
?xaRELAYsrvjpo,\
?xaRELAYsrzzpo,\
?xanvpbpo,\
?xaszCOMpo,\
lzssIMPOSSIBLE,\
zrenwCTX,\
zrbnwCTX,\
?SRbnwCTX,\
ypntps,\
ypenwCTX,\
ypbnwCTX,\
pbbnwCTX,\
ypftyd,\
?fnvSROUTINE,\
?NEVERzf,\
eqbDESCRIPTIONpblxlzxk,\
vynspb,\
?snobbmyzc,\
srvfeps,\
XA_RBTIMEOUT XA106,\
XA_RBDEADLOCK XA102,\
NEED_REPREPARE,\
?DELAYEDtr,\
!henntc,\
!huarc,\
uxoiBUILTIN,\
!huxBUSY,\
znrzvl,\
hoyymwg,\
?xaqypo,\
vyqyzkudvi,\
NDBwawoa,\
nmFNula,\
EXCEPTIONSzza,\
ylstdnb,\
ylstpqnb,\
qhINEXISTENTtimx ,\
DATABASEti,\
dti,\
uqti,\
xtti,\
ydti,\
RENAMEDti,\
ylsxniTRXS,\
!htnASCII_SEPARATORcrf,\
DEBUG_SYNCyi,\
DEBUG_SYNC_HITsl,\
otwxwv ,\
wxh 01000,\
wxcqc 02000,\
wxpe,\
RESIGNALzylbqu 0K000,\
wxlvnkys,\
!hnjITEMyr,\
njITEMylst,\
yxLOCALE,\
vyrbwsIDS,\
?vhmfoo,\
wntiuqpq,\
uqmysma,\
kysmyzka,\
ylsxuqqhpra,\
MAXVALUEizli,\
ylsxzla,\
wkSINGLEuqpqa,\
pqystqASuqpq,\
uqprylst,\
lzwkoylhxnoy,\
lzwktflhxnoy,\
malhxnoy,\
lzwkrplhxnoy,\
lzxntflhwkoy,\
lzwkrplhxntf,\
lztgENGINESlhSELFssoy,\
masl,\
?UNUSED4,\
maxyd,\
malsmz,\
mayt,\
maxyzn,\
maxyqi,\
maNONTRANSlcTRANS,\
MESSAGElhxk,\
?xanqpn,\
vyfnvnq,\
INSIDEymvaxwlzqb,\
uusj,\
zuxxeREPLACEMENT,\
ktjdSTRUCTURE,\
kPERFSCHEMA_USAGE,\
hI_Swzd,\
INSIDEymvaxwlzDIRECT,\
xqqivaxwlzDIRECT,\
xdthqwGEOMmv ,\
ylstrlnb,\
spABORTED,\
obudvi 22003,\
?kSPVARysisl,\
matgENGINESlhSELFssoy,\
maMIXEDxk,\
INSIDEymvaxwxgsrBIN,\
xqqivaxwxgsrBIN,\
pnvjFROM_PARps,\
zlrzcINTysa,\
laojeuta 28000,\
?wvutlpux,\
?qouxzgpj,\
TRUNCATErdpx ,\
uxrzPERMANENT,\
vyqyzkudviMIN,\
vyqyzkudvitb,\
xnmfqf,\
MULTIzdsdnm,\
dNEEDS_REBUILD,\
!huaBELOWsl,\
rlmyylst,\
aiyqBODY,\
aiyxyqBODY,\
rlns,\
UNDOvoylly,\
marrrbwr,\
marrwrzd,\
mavxwr,\
manvrbwr,\
manvvxwr,\
mazdrb,\
uxeUNINSTALL,\
uxers,\
mazzlswr,\
manvwrls,\
marrTWOsf,\
dipxmp,\
zboy,\
malscFIRST,\
mgsnFROMdV2,\
xbDELAYzkudvi,\
txFDlhRBR_EVENTS_ALLOWEDilzxk,\
uqpfomua,\
uqpfuod,\
uqpfycd,\
uqINSTEAD_OFxt,\
yxuq,\
xzomtc,\
wkoqctauq,\
lzmfwyGREATERyftb,\
hrlcAPPLICABLE,\
uqpfqasd,\
?exvsdzk,\
wlrnobylst,\
?NETWORKvjpbCHECKSUMpo,\
?lzvjpbCHECKSUMpo,\
lzxnmfwyGREATERyftb,\
fzddinvdwr,\
uqmstwtp,\
wkoqctaGIVENuqwv,\
?exvuq~zc,\
mjwlrnwbpo,\
ztcnewgzxCREATEDycd,\
ztcnewgzxDROPPEDycd,\
MTApprztr,\
MTA_UPDATED_DBS_GREATERtb,\
MTAfPARALLEL,\
MTAriob,\
qgtrzxur,\
oabnktt 35000,\
INSECURE_PLAIN_TEXT,\
INSECUREmjxb,\
qaousdzxmrrn 23000,\
qaousdzymrrn 23000,\
SQLTHREADzxwqvy,\
dqveFT,\
zncwwiSFubyq,\
zncwwiym,\
?jtmrzcijtmsm,\
?fmjjtmiym,\
wvxkmgINVOKEqi,\
jtmflwAUTOMATIC_IFjtmsmrztnts,\
?SKIPPING_LOGGEDym,\
svjwvxe,\
svjwvENCODING,\
svjxe,\
GNO_EXHAUSTED,\
lvvylquz,\
lquzwdjtfctv,\
fDO_IMPLICITnciTRXzvjtmrzwv,\
jtftwwdENFORCEjnotw,\
?jtfwdlz,\
fwvjtmykjzvjtfrztv,\
fwvjtmykljzvjtfrztw,\
fwvjtmsmyktntszvjtfrztv,\
?qcjpbzvjtfrztv~zc,\
jyztnTRANSACTIONALd,\
jyznvwr,\
?jyznvosycdiym,\
jtfCANtxmjONE_STEP_AT_Ayh,\
xbqvvgwcqs,\
fwvjtmzvOWNINGj,\
yxpkqb,\
fEXECUTEivjtxym 25006,\
ylstduqnb,\
vynl,\
rqFTsl,\
rqeFTycd,\
rqFTkDOCIDmy,\
rqFTkDOCIDrl,\
rqONLINEsrylly,\
yxlgle,\
yxlgsp,\
MTAmjxbfRUNzxGAPS,\
MTAvppo,\
MTA_RESET_WORKERS,\
mvnuortantV2,\
vySILENT_RETRYym,\
DISCARDpxmqwm,\
dwotd,\
dixyya,\
IOvja,\
IOzza,\
yate,\
yapj,\
yaDISCARDED,\
INTERNALa,\
rqrga,\
rqrlns,\
bYEARmysj,\
cVALIDut,\
thmjut,\
pxerlmr,\
pxerluj,\
pxpmADDxy,\
pxmgtyuj,\
pxrjua,\
pxotti,\
utqb,\
pxmymgos,\
pxmymgosmr,\
pxmycts,\
otrl,\
pxmymgmj,\
pxmymgmjmr,\
?UNUSED5,\
svuf,\
vjtxtf,\
jtmysUNDEFINEDj,\
zncwwixc,\
?fwvjvgzvjtfrztv,\
fwvjvgzvjpgrzcow,\
fwvjvgzvOWNEDqsrzcow,\
jvgWASmk,\
jpgWASmk,\
lzxntflheREPLxz,\
lgtztr 0A000,\
lgtztrvm 0A000,\
lgtztrvmCOPY,\
lgtztrvmuq,\
lgtztrvmpxRENAME,\
lgtztrvmmyys,\
lgtztrvmpxmp,\
?UNUSED6,\
lgtztrvmNOPK,\
lgtztrvmls,\
lgtztrvmHIDDEN_FTS,\
lgtztrvmmjFTS,\
lgtztrvmFTS,\
?xgvySKIP_COUNTERcwwijtf,\
otyxirl 23000,\
IDENT_CAUSESylstuu,\
lgtztrvmcts,\
thmjutLOGIN,\
wkikuq,\
MTApbBIGGER_PENDING_JOBSwytb,\
?rqeFT_USESum,\
lzLOGICAL_CORRUPTION,\
hvfsrize,\
hvfsrrzlb,\
lqrknm,\
!htwBLOCKHOLEiRBR,\
vyCMrowb,\
vyAMrowb,\
laojmjzga 28000,\
rqvjtx,\
xovyxgygyi,\
xovyIOygyi,\
dns,\
ycpszzpo,\
rqFT_AUXcHEX_ID,\
OLD_TEMPORALS_UPGRADED,\
rqFORCEDvp,\
AESbIV,\
uxmglwUNINSTALLED,\
jyzlzSPLITTABLExklhASSIGNEDj,\
vyqvMOREqsyfxb,\
tesd,\
!hNAMED_PIPElaEVERYONE,\
@3000,\
psns,\
atwxb,\
?ria,\
STORAGEoycLOADED,\
GET_STACKEDoazylbqu 0Z002,\
hLEGACYxxCONVERTED,\
maqgux,\
mgDISCARDydd,\
pxDEPTHpc,\
mvnuortaPLEASEzdV2,\
hyqorqwCREATED,\
vuypoqcpi,\
pktr,\
bpqwy,\
teHAnvua,\
oyudMEMORY,\
utEXPIREljzg,\
vyxgygthxo,\
eFT_MATERIALIZEDxu,\
rqUNDOsrqf,\
blmpyLOGARITHM 2201E,\
vymlIOygthxo,\
htyycxzthlwZERO,\
htxxbsrpsePOS,\
vhyi,\
tnROwronTIMER,\
otsmoz,\
?xgtfeEFFECT,\
lducpyUNION,\
lductnAGGvh,\
vyWORKER_STOPPED_PREVIOUS_THDa,\
?DONT_SUPPORTvyPRESERVEncuc,\
wsOFFLINEtf,\
GISomSRIDS,\
GISzblm,\
GISyxa,\
GISyxpe,\
GISbob 22023,\
mbqmowINPUTpe,\
mbqmCENTROIDpe,\
mbqmOVERLAYbINPUTpe,\
mbqmTURNrnpe,\
mbqmSELF_INTERSECTION_POINTpe,\
mbqmyxpe,\
xmlvALLOCa,\
xmDOMAINa,\
xmsja,\
xmblm,\
xmudvia,\
xmuea,\
xmvia,\
xmUNDERFLOWa,\
xmLOGICa,\
xmRUNTIMEa,\
xmyxpe,\
GISobkENDIANESS,\
mjxbutsj,\
zgspkti ,\
zgspDEADLOCK,\
vxINACCESSIBLE_ROWS,\
lgtztrvmGIS,\
rdzgzm ,\
jtftv,\
?zbmewayg,\
rjys,\
pqiuccwr,\
ldiuccwr,\
bwlWILDdpvPATTERN,\
tlOKufylsh 08S01,\
bscob,\
bqlteMEMBER,\
bqlkys,\
bqlUNSPECIFIED,\
DIMENSIONzb,\
vymloqcpi,\
?xatgmmqzPORT,\
vymltibubylst,\
vyNEWmlkwb,\
?xamloi,\
vytgmmCMD,\
vytbmmpc,\
vymlthxo,\
vymlcwm,\
vymlWASwm,\
vymlWAScwm,\
vymlxgygthxo,\
vymlxgSKIP_COUNTER,\
kpqzxqpV2,\
MIX_OFqpqhlhprV2,\
zuSYSVARzd,\
zuSQLMODE,\
mgsruposDATABASEzxj,\
qpwanl,\
qpwawm,\
qpwalkroa,\
qpwaxolkygyi,\
qpwandLAYERwua,\
qpwandLAYER_JOINa,\
lxDMLzja,\
vaznzyRBR,\
RUN_HOOKa,\
ymwgovnc 40000,\
qkmyqirztq,\
zblgINPLACEtwzsmy,\
kpxuapyqkmy,\
tnoezkpyqkmy,\
zbACTIONtwqkmy,\
qkmytnPRIOR,\
okmeqkmy,\
qkmyREFlqINC,\
ppclt,\
fwvjtf,\
fzelquzzxjtftv,\
?fvzljzxlquz,\
?fvzljzxjtftw,\
?fvzjzxjtftv,\
fENFORCEjnozxONGOINGjVIOLATING_TX,\
ENFORCEjnohzxONGOINGjVIOLATING_TX,\
ACCOUNTqvBEENsq,\
kyati ,\
yarzcow,\
kpsti,\
mbqmriTURNSpe,\
hOPTIMIZER_HINTxxa,\
hlvtbphyh,\
hzbtbphyh,\
hCONFLICTING_HINT,\
hyxQBti,\
UNRESOLVED_HINTti,\
htwMODIFYINGjpgd,\
PLUGGABLE_PROTOCOLnatr,\
LOCKINGwtkti ,\
LOCKINGwtDEADLOCK,\
LOCKINGwtyi,\
GIStbPOINTSiqmOVERFLOWED,\
xgtfMERGED,\
?VTOKENuxTOKENtd,\
?VTOKENuxTOKENcqc,\
fwvznzvOWNINGj,\
vymltztq,\
bscTEXT 22032,\
bscTEXTiug 22032,\
bscBINARYob,\
bscuu ,\
bscmo 22032,\
bscmoiqi 22032,\
byspysc 22032,\
bCASTyksc 22032,\
bscuumo ,\
bscuuWILDCARD ,\
sczkylly 22032,\
scsdylly 22032,\
sczfASsd ,\
scVACUOUSuu ,\
sclvONEubALL_ARG ,\
NUMERICsczkudvi 22003,\
bsczkpyCAST 22018,\
scDOCUMENTylDEEP 22032,\
scDOCUMENTtssd 22032,\
wqTRANSPORTwc,\
ewqTRANSPORTS_CONFIGURED,\
ooSTORAGEoy,\
zgoqcpi,\
zglfpj,\
AUDIT_API_ABORT,\
bscuuARRAY_CELL ,\
BUFPOOL_RESIZE_INPROGRESS,\
ppooSEE_DOC,\
wsISNTlt,\
wuWAS_KILLED,\
mhpc,\
mhpciviOPTIMIZER,\
?dNEEDS_UPGuo,\
fWAITpypgjwvWHILE_OWNING_Aj,\
mgADDqaBASEmvzs,\
mgnvzsrlnp,\
atwMODIFYINGjpgd,\
spREFUSEDmeoy,\
zblgONLINEtwzsmy,\
szsdwitrmeSE,\
?szsdwiameSE,\
szsdwilzpn,\
szsdwiSE_UNAVAILABLE,\
yamgENCRYPT,\
boxua,\
mgFINDsdise,\
mhpcium,\
zblgoxINPLACE,\
seytsewta,\
zgmyOLDsj,\
fRESETxb,\
qpwatbqpwy,\
mgADDqaBASEmvxq,\
dvu,\
?uqoyolpyd,\
?hzhGEOMFROMWKBykwvxhZERO 01000,\
?hzhGEOMFROMWKBykwvxh 01000,\
XA_RETRY,\
seAWSytAWS_KMSa,\
maXA,\
yta,\
seMIGRATIONpo,\
selaoja ,\
seMIGRATION_STATUS,\
?uxpnyktyxz,\
?uxpnyktyd,\
?loeseuxrt,\
?looxutqvcBEENwv,\
?loCOULDcnvAESsd,\
?looxutmglwFETCHED,\
?loscFILTERINGcENABLED,\
?loytrvvc,\
?loSUPERvcwc,\
?COULDcREINITIALIZElopw,\
?loytblmys,\
?loytblmnu,\
?loqvcBEENrt,\
?loytvjbtbARRAYsjARGys,\
loytvjbtbARRAYsjARGzk,\
?loscpvuna,\
?loscpvtimglwow,\
?losczgtimglwow,\
?loscpvoqcpj,\
?lozgFIRSTmnthlwALPHANUMERIC,\
?lozgtibmn,\
?loqztibmn,\
!OBSOLETEzuMAXDBxgtfpyyj,\
?XAwapw,\
?ftyasr,\
?qqtwyjiDST,\
?fxjwsNAMED_PIPE,\
zzwvpdsl,\
?olTLSzqwu57,\
?zuTLSzq57,\
?hktjdSTRUCTURE,\
AESbKDFti,\
AESbKDF_ITERATIONS,\
!hAESsdwy,\
AESbKDFuawy,\
@3500,\
UNSUPPORT_COMPRESSEDydd,\
ACLtzpn,\
zbrlle,\
exvDB 42Y07,\
yllyENUM,\
ylstwvENUMzk,\
bDDtu,\
UPDATING_DDd,\
bDDtuID,\
bDDtuti,\
yatezxti,\
ylstwjnb,\
xcsnpn,\
bBITWISE_OPERANDSwy,\
bBITWISEldOPERANDSwy,\
hzbHINT,\
yvqmys 22S01,\
xiula SR002,\
xiPROJuhte SR003,\
hxicqc 01000,\
xicmi 22S00,\
xicmiUNDEFINED SR001,\
PKrlflwINVISIBLE,\
yxAUTHID,\
pnwfqo,\
tywfxz,\
pnoeROLES,\
ngeSCHEME,\
ngeSCHEMEwt,\
ngfsn,\
wfcGRANTED,\
pnREVOKEwf,\
RENAMEwf,\
ngfACQUIREwtre,\
ngfSATISFY_DEPENDENCY,\
ngsnfREGISTERwtre,\
ngsnfINITIALIZE,\
ngyycLOADED,\
ngyyfDEINITIALIZE,\
ngfRELEASEwt,\
ngyyfUNREGISTERwt,\
ngfyy,\
hyyTHEcuw,\
nfdrj,\
nfMANIPULATEwkpn,\
ngyyouiqp,\
fwvjvgDUE_SETS_CONSTRAINTS,\
mgspzgMANAGEMENT_CACHES,\
xicqc SR001,\
zncuw,\
rzvhbms,\
yuykxpxl,\
exywola,\
exyyala,\
exydla,\
exydlapyDICTIONARYd,\
exydlapyxyd,\
exydlapyd,\
buasd 22023,\
buazk 22023,\
buasdzkPAIR 22023,\
buaxjmn 22023,\
buaENDmn 22023,\
buaCHARACTERS 22023,\
ouuasd 22023,\
hxicqcAXISuc 01000,\
elayktjFCT,\
RESETxbykzkudvi,\
UNRESOLVEDdsp,\
oudsp,\
maSKIPsq,\
maNOWAIT,\
spNOWAIT,\
CTEvrwdUNION,\
CTEvrwdNONRECURSIVE_FIRST,\
CTEvrFORBIDS_AGGREGATION,\
CTEvrpzJOINuc,\
CTEvrwdSINGLEvt,\
xwTMPoy,\
zwexvzw,\
zwCIRCULARITYizwGRAPH,\
zwemrur,\
zweINHERITqe,\
zweREDEFINEucme,\
zwqexjrd,\
zwqeENDrd,\
zwqerd,\
zwviqeucys,\
zwviqeTEMPORALys,\
zwviqeNUMERICys,\
zwviBOUNDcCONSTANT,\
zwouti,\
zwrducme,\
zwbzwqhze,\
zwbzwqhALIASze,\
zwtkzwqhzeizwSPEC,\
zwROWSrxze,\
zweqpuczc,\
zwpksc,\
zwqiIGNORESqe,\
WL9236_NOWzc,\
beOF_ARGS,\
pqiqqcqpme,\
ylstyanb,\
oyfosd,\
oyfosted,\
yaotFILENAME,\
DBosRMDIR2,\
IMPepuMATCHED,\
IMPwooqcpi,\
IMPdlfpj,\
IMPrhMYSQLDzq,\
IMPrhDDzq,\
IMPrhSDIzq,\
hbHINT,\
zmoqcpi,\
suudvi 22S02,\
siudvi 22S03,\
crfpyGEOGRAPHICxi 22S00,\
rdvcLEVEL,\
exyzrla,\
nfpvFLABBERGASTED,\
uoEXPRylst,\
ytosDYNAMICALLY_REGISTERED,\
yuykxpmyxl,\
yuykzdmyxl,\
yuykosmyxl,\
yuykBUILD_HISTOGRAM,\
swwf,\
teyaps,\
uvtxlaoja ,\
?CMD_NEED_SUPER,\
uuiDATADIR,\
muDDLiPROGRESS,\
muylsxniCLONES,\
lksrpbzja,\
CTEtbvqDEPTH,\
cHINT_UPDATABLEzn,\
CREDENTIALS_CONTRADICTykHISTORY,\
ztutHISTORY_CLAUSES_VOID,\
mtoqcSUPPORT,\
I_Swzya,\
yaoytd,\
kxhpymy,\
mglgxhDUEykrl,\
hlzupUPDATESoo,\
?hlzV1wkEVENTSoo,\
hlzupUPDATES_SUGGESTSupIMAGES,\
COULDcAPPLYscDIFF,\
ntscDIFF,\
weqppj,\
weqpcpj,\
bVCPU_ID,\
bVCPUvi,\
bygPRIORITY,\
optz,\
weqpBUSY,\
weqpoo,\
ppzb,\
lnrc,\
bygID,\
weqpBINDpn,\
bzeOF_FORCEua,\
qpwanapo,\
SDItzpn,\
tescdzk 22035,\
kscdzk 2203F,\
TFthqwALIAS ,\
TFpzJOINys,\
JTzkudvi 22003,\
JTtbtkuu ,\
utEXPIRATIONtrmelpMETHOD,\
bqlCRScTOP_LEVEL,\
lvtsacrc 23000,\
!hUSELESSxdrl,\
DISKqfNOWAIT,\
ulaiDIGEST_FN,\
UNDISCLOSEDulaiDIGEST_FN,\
woDIRpj,\
woDIRte,\
woDIRnvpn,\
woDIRyx,\
txrfpyxh0lh4326 22S00,\
?lzEXPIREsrDAYSlhSECSzfTOGETHER,\
vvmcue,\
vvrdlm,\
vvrlOUTOFBOUNDSa,\
vvINTERNALa,\
vvRULExx,\
vvlvESCAPE_SEQUENCE,\
vvUNIMPLEMENTED,\
vvMISMATCHED_PAREN,\
vvlvrx,\
vvtbLT_MIN,\
vvbBACK_REF,\
vvLOOK_BEHINDsl,\
vvteCLOSE_BRACKET,\
vvbvi,\
vvSTACKue,\
vvyhOUT,\
vvPATTERNylly,\
fwvasrwt,\
owPIPELINEpyasrwt,\
nfpvDIAGNOSTICS,\
crfpymixi 22S00,\
crfpyPROJECTEDxi 22S00,\
NONPOSITIVE_RADIUS 22003,\
RESTARTwspn,\
xiteswln SR006,\
xitglnDEFINITIONS SR006,\
xitiflwowubWHITESPACE SR006,\
xiORGANIZATIONflwowubWHITESPACE SR006,\
xiIDlfpj SR004,\
hxiIDlfpj 01S00,\
fMODIFYxh0 SR000,\
hRESERVEDxhvi 01S01,\
fMODIFYxizfmemy SR005,\
xibmniln SR006,\
xilnxrylst SR006,\
olUTF8_ALIAS,\
olNATIONAL,\
boeUTF8MB4mw,\
yuykCOLLECTsrSTATUS,\
RESERVEDyati,\
yuykwvua,\
vyPOSSIBLY_DIVERGEDlcDDL,\
xicGEOGRAPHIC 22S00,\
POLYGONylsh 22023,\
xdywrl,\
rlystrpyxdrl,\
pxmgosuj,\
qmugsuudvi 22S02,\
qmugsiudvi 22S03,\
pxmgzezsmy,\
pxemyuj,\
fwvaSUPPRESSIONsm,\
xiGEOGCSbAXES SR002,\
xibSEMI_MAJOR_AXIS SR002,\
xibINVERSE_FLATTENING SR002,\
xibANGULAR_UNIT SR002,\
xibPRIME_MERIDIAN SR002,\
yoxbxitr 22S00,\
yoybxitr 22S00,\
yoxbxiteTOWGS84 22S00,\
yoybxiteTOWGS84 22S00,\
ycdvaxwwulzqb,\
ycdvaxwqnlzqb,\
wmlkvaxwqnlzqb,\
mtjyznvosycdiTRXiSBR,\
?XAfnvMDL_BACKUP,\
dzyPK,\
hobyrqjrl 01000,\
hobudviqjrl 22003,\
qjrltwscubqmqi ,\
qjrlREFlqrk,\
mgosmyqjrl,\
qjrlvbsd,\
qjrltwLOB,\
qjrlqirztq,\
qgqjrl,\
xdqjrl,\
ksdmyqjrl,\
qjrltwpq,\
qkmyNAMEDqirztq,\
qkmywkzk,\
qkmyzo,\
okmeoeqkzk,\
oeVALqktnPRIOR,\
oeVALqkREFlqINC,\
oeVALqkqirztq,\
oeVALqkNAMEDqirztq,\
oeVALqkwkzk,\
oeVALqkzo,\
oeAS_VALqk,\
zbACTIONtwoeVALqk,\
jyzlgADDmvzxoeEXPRESSION,\
pxmgmjoy,\
zuzgwvEXPR,\
zuUTF8MB3mw,\
zutknbxx,\
pxrhmz,\
GR_HOLD_WAITyi,\
GR_HOLD_KILLED,\
GR_HOLD_MEMBER_STATUSa,\
wloxpnykFETCHsd,\
wloxsdcqc,\
wloxsebsd,\
wloxqxa,\
wloxpnykwhLOGS,\
wloxsdpjyv,\
wloxpnykGENERATEsd,\
wloxpnykxpsd,\
wloxpnykREMOVEsd,\
wloxyuykmjua,\
wloxszsdvppn,\
SLOWsrtfrczvcssykps,\
qrTRXnotq,\
qrTRXnolx,\
qrTRXnolctwTRX_BEGIN,\
qrTRXnoBEGINtq,\
qjrlwkzkrztq,\
wloxpnykENCRYPT,\
PAGE_TRACKINGcSTARTED,\
PAGE_TRACKINGvicTRACKED,\
PAGE_TRACKINGmgvf,\
wloxmgwhlzszsd,\
lzszsdvpudCOMBINATION,\
lzszsdwipmykOPERATEsd,\
lzszsdwipmykwhLOGS,\
lzszsdwipmykREENCRYPTsr,\
lzszsdwipmykCLEANUPzcsf,\
lzszsdwipmykCLEANUP_AUXsd,\
tnBOOLEAN_EXPRpympnp,\
mympnpREFERENCES_OTHERmy,\
mpnpNAMEDqirztq,\
mpnpqirztq,\
mpnpzo,\
mpnpwkzk,\
mpnpREFERSlqrkmy,\
mpnpVIOLATED,\
mpnpREFERSyxmy,\
mpnpcqc,\
mpnpotti,\
mpnpmszhpxREFER_ACTIONmy,\
!hUNENCRYPTEDdiENCRYPTED_DB,\
boxREQUEST,\
mgwvdox,\
mgwvDATABASEox,\
mgwvyaox,\
yamglwENCRYPTED,\
yamglwDECRYPTED,\
yaysyx,\
ybyaUNENCRYPTED,\
mgzeoxms,\
btgCLAUSES,\
zbzeOFqoAS,\
UKNOWNlpIDublaojpyqoAS,\
okmeqjrl,\
uxcEARLY,\
rqvssrllxjSUBDIRuu,\
rqvssrllxjyi,\
rqvssrllDIRSb,\
rqvssrllLABELcqc,\
rqvssrllDIRow,\
rqvssrllexvDIR,\
rqvssrllDIR_CLASH,\
rqvssrllDIR_PERMISSIONS,\
rqvssrllpsnv,\
rqvssrlllb,\
rqvssrllINACTIVE,\
rqvssrllpn,\
rqvssrllwu,\
xmREGEXa,\
bscys 22032,\
mgnrxr,\
okmeuqqh,\
zuFLOATlqrk,\
wlfxovyWHILEsqBACKUP,\
zuFLOAT_DIGITS,\
zuFLOAT_UNSIGNED,\
zuINTEGER_DISPLAY_WIDTH,\
zuZEROFILL,\
muDONOR,\
muPROTOCOL,\
muDONORzq,\
muOS,\
muPLATFORM,\
mumo,\
muCONFIG,\
muSYS_CONFIG,\
muuxta,\
muLOOPBACK,\
muox,\
muDISK_SPACE,\
muiPROGRESS,\
muop,\
mgqoROLESykljzg,\
wpoyux,\
SECONDutmglwow,\
DBlaoj,\
oalpIDzxxyzgPRIViswROLES,\
oawljdmgty,\
qmiyxsjUNIT SU001,\
oauxrsa,\
ewuyc,\
oayxatt,\
mymjwy,\
vvbCAPTUREqpti,\
oaSSL_LIBRARYa,\
wpoy,\
wpoyDDL,\
rjnyut,\
tenyut,\
nyutcwc,\
utmglwRETAINEDtwuxmj,\
nyutmglwRETAINED,\
upREVOKESpi,\
mgqoxyPRIVykswwf,\
XAwapw,\
zbxgtf,\
vvbFLAG,\
upREVOKElhDBqoBOTHpj,\
UNITcqc SU001,\
bsczkpyqhrl 22018,\
sczkudvipyqhrl 22003,\
pcMVsfNUM,\
pcMVsfSPACE,\
qjrlobrzylst 22001,\
kMVIzk,\
hqhrlcAPPLICABLE,\
qrwlyta,\
zdjvgzxGR,\
qqtwyjiDST,\
dtiCAUSESylstuu,\
lorvvc,\
?loutqvBEEN_COPIED,\
oaqrwlSTARTEDlqREJOIN,\
SYSVARmjovvh,\
GLOBSTATmjovvh,\
qrwlMESSAGEwtropo,\
mjxbknhlemt,\
mjxbknhLEVELmt,\
knhlemt,\
knhLEVELmt,\
mjxbknhlesmmt,\
mtvcmqzgmglwlj,\
mtvcmqzgoqcpi,\
mtvcmqzgns,\
mtvcmqzgNEEDSwllkPRIV,\
hoavccREGISTERED,\
mtseytsdb,\
mtseytsdysb,\
mtseytsdylst,\
mtseytsdysylst,\
scwozjazxDETAILED_REPORT,\
oaytbmoxf,\
oaytbmo,\
oaytbmw,\
oaytbEXTENSIONlmys,\
tgCONSTRAINTSzxwnti,\
npcqc,\
lgnpENFORCEMENTtr,\
dzkCONSTRUCTORthqwmz,\
dzkCONSTRUCTORmgqwoe,\
mtvhpobtnwkqb,\
REQUIREwkqbbzk,\
pnykDETERMINE_IFwfrzsw,\
pnykFETCHswwfsm,\
mtLOCALpuoo ,\
IMPrhCFGzq,\
oaOOM,\
oaytblmykwvmo,\
oaytbRETURNysykwvmo,\
tgryCLAUSES,\
MISPLACEDry,\
zglaojpyzgACCOUNT_BLOCKEDmeutsp,\
zuYEAR_UNSIGNED,\
muNETWORKuf,\
SDItzpntevo,\
okmempnp,\
qrtztqGRthxo,\
zuscdtwatwow,\
zuINNERry,\
zuzlqiALWAYSts,\
zuxgCALCqcROWS,\
zuqcROWS,\
tesczk 22035,\
tgsczl 22034,\
HOSTNAMEylst,\
?hmtoluqPREFIXsd,\
qpwazgowMSG,\
qpwazgswMSG,\
qpwautsj,\
xuyoREJECTED,\
oaqrwlvpENDPOINTqb,\
oaqrwlvpENDPOINTb,\
kzkpyzmPLUS_ACTIONABLEuo,\
xktqlcxjym,\
qasdzxATOMICnvwr,\
tqzxxjym,\
bscln,\
oylntr,\
bzglnsc,\
rqvsoo,\
rqvsARCHIVING_ENABLED,\
MDLudRESOURCES,\
IMPLICIT_COMPARISONpysc,\
qioqcSUPPORTmnwv,\
IMPOSSIBLExrnq,\
wovjtx,\
wlASYNCvnjtftv,\
wlASYNCvnlquztv,\
onjtfwdASYNCvntv,\
onlquzwdASYNCvntv,\
buhze,\
mnwvtd,\
hzmzkmjtr,\
byhZONErx,\
bCAST,\
ratrYET ,\
?hraEXPERIMENTAL,\
oaeasrumCONFIGURED,\
oaasrdoo,\
oaasrtgpw,\
oaftyasr,\
zgvuASog,\
mgzgvuASog,\
REGEXttylly,\
SPVAR_NONINTEGERys,\
!hzbACLxzvj,\
maACLdvjiDML_DDL,\
xovyMONITOR_IOygyi,\
STARTINGvyMONITOR_IOyg,\
fzeljykjzxjtfctw,\
fCOMBINEljykjlhAUTOPOSITION,\
ASSIGNqsykljynwdjtftw,\
xgvySKIP_COUNTERzfzxjtftw,\
zhASSIGNqsykljynAS_LOCALubzi,\
?wvjykANONlhWAIT_UNTILxgTHDlcqs,\
fwvxglcublxqszxljykj,\
ljykjziwnASqpti,\
fzewnziASqpti,\
qrwlvpmlSTILLwm,\
rqblrwyzk,\
rqrhzxya,\
rqlrwyudvi,\
mgzelrwyms,\
wfGRANTEDykITSELF,\
dthqwA_VISIBLEmy,\
rqnhpo,\
hASYNC_CONN_FAILOVER_NETWORK_NAMESPACE,\
mtINTERACTIONyi,\
bCASTykqm 22S01,\
bCAST_POLYGON_RING_DIRECTION 22S04,\
GISomSRIDS_AGGREGATION 22S05,\
RELOADsepo,\
SDI_GETsfbya,\
mjwlSRCknhlewy,\
?zuTLSzqpymlCLI,\
fzewnziASzrmjzi,\
ljykjziwnASzrmjzi,\
qrwlzrmjzipmGETzn,\
hADUITsrtbwylhPRUNE_SECONDS,\
hADUITsrtbwyCLOSEykwhtwwy,\
KERBEROSnvzg,\
rsuxnmmt,\
oaasrnfFLUSHpn,\
hxglcMTS_GAPS_GAPcCALCULATED,\
bASSIGNMENTyb ,\
tztqtwGRwp,\
qrwlFAILOVERmlSTATUS_PROPAGATION,\
hloqbUNIXyjtxzvsc,\
bMFAuxxf,\
IDENTIFIEDmezb,\
buxpyvw,\
uxwdvw,\
MFA_METHODpj,\
MFA_METHODcpj,\
AUTHENTICATIONuytd,\
uxvwDONE,\
bzgpyvw,\
zgvwpn,\
MFA_METHODSbuc,\
MFA_METHODS_IDENTICAL,\
bMFA_OPERATIONSpyPASSWORDLESSzg,\
mjwaxbeOPTIONSpyjtx,\
mjREPxbfonREQwkqbzxjtx,\
mjREPxbfonlquzzxjtx,\
mjREPxbfonjtxzyPOSITIONS,\
mjREPxbfonlqPOSzyPOSITIONS,\
mjREPxbGRmlzxjtfctw,\
fzejtxzxjtfctw,\
hConjtxzxxblqPOSbPOS,\
oaSSL_FIPStfa,\
zkudvi,\
qgzxROLLUP,\
vvtewe,\
hvvzhoe,\
vvteps,\
zumw,\
niveUSAGE,\
oaqnCONNsl,\
oaCONNsl,\
lgtztrvmmyysru,\
hSFyttimx,\
mgvflzzxBACKUPsp,\
ylsxWINDOWS,\
MYSQLBACKUPmtMSG,\
nbCONTAINSbxr,\
ohCONTAINSbxr,\
fEXECUTEnazxASSIGNEDjtm,\
XAycd,\
rqtbwkzq,\
?rqruADDtrtbwy,\
tztqWHILEvbmjrzwm,\
zuocDELIMITER,\
zuSUPERFLUOUS_DELIMITER,\
mguvSENSITIVEzo,\
hmgSECURELYuvSENSITIVEzo,\
hyplfpj,\
IFcpjzbyppjtwomd,\
IFcpjzbyttjFCTtimx,\
wvutlpuxa,\
?REDUCED_DBLWRpsnt,\
?REDUCED_DBLWR_PAGEqc,\
xibsiOF_ORIGIN SR002,\
xibsuOF_ORIGIN SR002,\
xizcPROJuhPRESENT SR002,\
GIPKmypj,\
GIPKpnlsmypj,\
GIPKmylgtq,\
osPKmyykosGIPK,\
nvwrzxGIPKopiSBR,\
?oaEXPIRE_LOGS_DAYSrc,\
CTEvrcUNION,\
naBACKENDpnykFETCH_SECURITY_CTX,\
nawtBACKENDpn,\
mtpsvcpywamq,\
qpwaFORCE_MEMBERSnapo,\
zuIDENT,\
INTERSECT_ALLtbDUPLICATESpc,\
TPvhTHRS_PERqrpdTXN_THRsl,\
lvyjqb,\
SHAPE_PRIDICTIONyt,\
xibHEIGHT SR002,\
xibSCALING SR002,\
xibZONE_WIDTH SR002,\
xibsiPOLAR_STEREzmA SR002,\
zumtewoua,\
dcow,\
devbsd,\
diSHAREDya,\
rlOTHERyfPK,\
snmdobUNSORTED,\
mdEXECUTORa,\
mdvkskropn,\
mdvkska,\
mdvkwsa,\
mdvknda,\
mdsnobpn,\
mdsomyyllypyLEFTOVERmc,\
mdsonfa,\
mdsopsCONTAINS_LESS_LINESyfrbms,\
mdumteENCLOSEDme,\
mdumwkmctbTOTAL_COLSpc,\
mdumCOPYmcwypc,\
mdumyvEND_OF_INPUT,\
mdumyvwkye,\
mdumyvCHARlcENDING_ENCLOSEDme,\
mdumyvCHARlctsESCAPE,\
mdumyvCHARlcmyye,\
mdumINCOMPLETE_ESCAPE_SEQUENCE,\
snmdobpn,\
snmdobkzkpypq,\
snmdobhtsykNOTNULL,\
REQUIREdvbsdmpGENERATEzxGR,\
fmjSYSzmivjtxtf,\
rqruADDostrtbwy,\
rqruADDtrtbpr,\
fwvuw,\
rsnfwvtszk,\
rsnfwvzczk,\
zuzgofCOLLATIONS,\
zgspOVERLONGti ,\
heSPACEzqnb,\
VALIDATEutrvmkCHARACTERS,\
zuzxNOTE,\
fRUNnaSERVICES_RECURSIVELY,\
hlopvvpssoo,\
@6000,\
sgnf,\
sgnfclt,\
sgnfzbsg,\
sgnfmgUNINSTALL,\
xcelgsg,\
?pkryANALYZEtr 0A000,\
pkryIMPLICITqbtr 0A000,\
pkryqbtr 0A000,\
tsflwuwpyvl,\
pkrypynntr 0A000,\
rqrgkDROPPED_ENUMsj,\
rqrgkttOF_INDEXES_ZERO,\
rqrgkttOF_INDEXESylHIGH,\
rqrgosmvtctd,\
rqrgENUMtsyete,\
SIMULATEDrpa,\
zuDYNAMIC_PRIViqo,\
mdMULTIvktypspn,\
mdMULTIvkvjpspn,\
mdMERGEbCHUNK,\
mdMERGEcALL_CHUNKS_CONSUMED,\
mdWRITERskropn,\
mdWRITERska,\
mdSORTINGsozz,\
mdSORTINGsoWAIT,\
mdvktypspn,\
mdsndqvruCOLS,\
mdsnwe,\
mdsnwpoy,\
mdvka,\
mdvkpsorpi,\
mdvkCOULDNT_RESOLVEqz,\
xjvymlbnl,\
mgEXECUTEivb,\
ylsxqpmeMODIFIER_BRANCHES,\
zuoyxxeREPLACEMENT,\
QUALIFYzyzwqi,\
SUPPORTEDtxzxra,\
SPECIFIClaoj,\
fwvjtmykAUTOMATIC_TAGGEDzvjtfrztv,\
jtmTAGjtftv,\
gmvcNULLABLE,\
ghmvtecNULLABLE,\
gmvrzow,\
gmvrzowh,\
glvzk,\
godyxpa,\
godOOMpa,\
ghodROUNDING,\
godPRECISIONpdwo,\
gpdMIN,\
gpdtb,\
ghpdMIN_TRUNCATING,\
ghpdtbTRUNCATING,\
gREALrzNAN,\
gudvi,\
gocqb,\
ghyr,\
gmgnrxr,\
gwePRINCIPALpa,\
gAWSlppa,\
gCSVunpa,\
gmytdpa,\
gmytbpa,\
gmozb,\
gukodnqpa,\
gxrylst,\
gwePRINCIPAL_BUCKETpa,\
gepuqc,\
gowps,\
goups,\
gluwoDEPTHpdtb,\
gluqxtd,\
gluENUMmgnrmo,\
gluENUMtd,\
gluysmgnr,\
glupsENDS_UNEXPECTEDLY,\
glupsobns,\
glubUNION,\
glubBLOCKwy,\
glubBLOCKvonu,\
gqbqxeMAGIC_BYTES,\
gluqxtcpa,\
gluqxewo,\
glueCODECiqx,\
glubtiiwo,\
gluDECODINGpa,\
guktnUTF8psENC,\
gukwotd,\
gukwkqpwypdtb,\
gukmgLOCATE_OFFSET,\
gukysmgnr,\
gukmgLOCATEwo,\
grmNUMmvtd,\
gOOM,\
ghrmwzLINES,\
ghrmwzpu,\
grmpsqveob,\
grmeob,\
grmepu,\
ghrmzeoemvNAMES,\
gukmgvjqx,\
grmhGOTpe,\
glumgulqx,\
gukftyps,\
gylshzkpa,\
gylshwkpa,\
TABLESAMPLE_PERCENTAGE 2202H,\
TABLESAMPLEtxtwBASExz,\
?uhrludvi,\
RESULTwyslpc,\
sgnfINTERNAL,\
sgnfCONCURRENCYsl,\
sgnfRUNTIME,\
sgnfTIMEZONE,\
sgnfKEYWORD,\
sgnfwvxyzn,\
sgnfzbys,\
sgnfnq,\
hxcxkPARTIALLYpg,\
xnphtqWITHINxcubypubyt,\
gscun,\
oymglwoe,\
uqPREFIXsdtr,\
zutnSTANDARDsd,\
pxeywrluj,\
laojePROXYqo,\
laojePROXY,\
gzgoblapn,\
mdvkZSTDa,\
mduma,\
gbscpsqbwo,\
grmscbwo,\
gscpsqbhrmwo,\
tnSCALARzfASsd,\
rhysAGG,\
obrhzxzp,\
pdzptbDIMENSIONS,\
ykzpnq,\
?plzbrlle,\
TPmgonMTLzxDL,\
qrwlnnHANDOFF_BUSY,\
@6400,\
wsOFFLINEtfvm,\
?wsOFFLINEtfzg,\
gzaeobqc,\
gzapsulpa,\
gzaENCODINGpa,\
gzapsystdpa,\
gzawopa,\
gmyoyATTRpa,\
gzaOBJvjpa,\
geSEGMENTSqk,\
gzapsylsh,\
pctbREGULARxkqtsl,\
pkANALYZEscqbzqtr 0A000,\
tnDML_DYNAMICui,\
DEPRECATEtnCOMPOSABLEtgoy,\
mdscb,\
mdBLOBylly,\
evhPLANqc,\
gCPylsxCHANGES,\
gCPcENABLED,\
gCPezpxp,\
gCPezjtf,\
?gCPteputf,\
gCPncpn,\
gzabsg,\
gzpylsxENTRIES,\
mdumyvENCLOSEDmemn,\
CMD_NEED_SUPERubnvxdvtxy,\
msrc,\
bmsiCONTEXT,\
bmsCOMBINATION,\
hREDACTED_PRIVILEGES,\
bOUTERvt,\
LIBRARIEStr,\
ghSUMMARY,\
ghrmzeoeDELIMITERS,\
LIBRARYb,\
mguvymISOLATION,\
glubvo,\
gbzkizp,\
ghzpLOSSYnq,\
gzaTRUNCATIONa,\
gzaPAGE_CHUNKh,\
gzaylsxCHUNKS,\
laojFIREWALL 28000,\
gDECOMPRESSIONpa,\
sbohkli,\
saALGO_TEMPTABLEtr,\
sazxmpuatr,\
sbohtnSIMPLEwrtr,\
sbohCTEtr,\
sbohGROUPBYtr,\
sbohzwqitr,\
sbohsltr,\
sbohORDERBYtr,\
sbohMULTIxztr,\
sboheWHEREnkixs,\
sbohWHEREnkiROOTOBJECT,\
sbohkWHEREqbpyxs,\
sbohkpqys,\
sbohCONTEXT_PREPAREpn,\
sbohesctuiROOT,\
sbohMUSTBEsctupySINGLETON,\
sbohMUSTBEsctupytk,\
sbohescOBJiARRAYAGG,\
sbohRELATIONSHIP_RULES_VIOLATED,\
sbohmyystr,\
sbohtnBASEdtr,\
sbohdzyPKqc,\
sbohdzyPK_PROJECTIONqc,\
sbohIDsdzfmecROOTd,\
sbohIDsdczfmeROOTd,\
sbdlipySINGLETON_OBJ,\
sbdlipytkOBJ,\
sbohousftr,\
sbohoumytr,\
sbohwndriPROJECTION,\
sbohmysmtr,\
sbohridpqiTHEtu,\
sbohWHERE_USEStnIMMEDIATEuj,\
sbohCOMPOSITEsdzf,\
sbohALIASczfpywnxz,\
satztr 0A000,\
salgubvxtr,\
sbscDUALITYtuUSAGE,\
sayvscys,\
savbsdthlwPROVIDED,\
saJOINnkcSATISFIED,\
saPK_DUPLICATEScIDENTICAL,\
saUNMAPPEDsd,\
saterrTAG,\
satevlxs,\
saJOINnkVIOLATION,\
sateETAG,\
saETAGtd,\
satezk,\
saPK_UPDATEStq,\
satezdTAG,\
sateoiTAG,\
satsrrzk,\
sarrzkcFIXED,\
satszdzk,\
sazdzkcFIXED,\
?sappEDITIONsl,\
samglwzfzx,\
saDMLrn,\
?satezkpyAGmy,\
sbBINARYysqx,\
ETAGtr,\
oylnnm,\
plqbtr,\
pldbua,\
pldoytr,\
pldoycxf,\
gepuqcewqpsPRIV,\
gmvtite,\
gmvtiou,\
gzaOCI_GENAIpo,\
gzauppsulpa,\
saEXPLICITlqrktq,\
grmmvtitd,\
gDELTAwotd,\
gDELTAtcvja,\
gDELTAzba,\
hACCOUNT_TRIMMED,\
ghoctgugze,\
gGENCOLa,\
TEMPORALqiue 22008,\
grmmytbpa,\
gEXTRAmzips,\
gukCOMPLEXnq,\
looo,\
lonfscpvuna,\
lopnyktyxz,\
lopnyktyd,\
lonfscpvtimglwow,\
lonfzgtibmn,\
loesert,\
lonfmgvjut,\
lonfqztibmn,\
lonfsczgtimglwow,\
lonfseIDyjzkrzb,\
lonfytblmys,\
lonfytblmnu,\
loABORT,\
loCOULDcRELOADpw,\
loytblmts,\
lotbwyCLOSEykwhtwwy,\
lotbwylhPRUNE_SECONDS_PRECEDENCE,\
loutqvcBEENwv,\
lobdoh,\
lonfpvpnykxpdFLDS,\
lonfpvpnykrodpyvj,\
lonfpvpnykoiFROMd,\
loscpvoqcpizg,\
gCUSTOMobPLACEMENT_OVERRIDES,\
glupuobystd,\
lonfbpvABORT,\
lonfscbpvmglwzf,\
hlopwb,\
saqklhEXPLICIT_PKStq,\
syuynfa,\
syuylfpj ,\
syuyEXPECTS_CASE ,\
syuyEXPECTS_CASEzv ,\
syuyteELSE ,\
syuyONEzvwc ,\
syuythRETURNlm ,\
syuybGATEKEEPER ,\
syuytnLITERAL_GATEKEEPER_ARG ,\
syuyopCONSTRUCT ,\
syuybmyvt ,\
syuyrhmypp ,\
syuyrhTYPES ,\
syuytnDETERMINISTICqh ,\
pxtbxziCASCADE_CHAINpc,\
pxCASCADEyqUPDATINGpxmztr,\
fzdzfdipxCASCADE,\
hwvOPERATIONSmc,\
sayvbzk,\
@6900,\
nxyxlkzq,\
nxlkWORKERnuudvi,\
nxlkWORKERnutxpyCSA,\
CSAzbUNTILnj,\
nxlkpbMEMORYsltxpyCSA,\
hnxlkpbMEMORYsludvi,\
CSAnxDELAYEDlktr,\
CSAnxREQUIREMENTwkqb,\
CSAnxREQUIREMENTjtx,\
oamgvzzylz,\
vyIDENTITYnm,\
mdvkuurzDIRECTORY,\
samyTAGtrpyxu,\
sazdmyTAGtrpyPK`
