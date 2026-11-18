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
export const ERROR_NAME_WORDS = 'NOT INVALID ERROR WARN TABLE NO CANT LH LOG IN GTID ACCESS ACTIVE AFTER AGGREGATE ALGORITHM ALLOWED ALREADY ALTER AND ANNOTATIONS ANONYMOUS APPLIER ARCHIVE ARGUMENT ATTRIBUTE AUDIT AUTH AUTO AUTOEXTEND AUTOINC AVAILABLE AVRO BAD BE BEFORE BIG BINLOG BOOST BUFFER BULK BY CACHE CANNOT CAPACITY CARTESIAN CHANGE CHANGED CHANNEL CHANNELS CHARACTER CHARSET CHECK CHECKS CHECKSUM CHILD CLAUSE CLIENT CLONE COL COLLATION COLLISION COLUMN COLUMNS COMMAND COMMENT COMMIT COMMUNICATION COMPLETE COMPONENT COMPONENTS COMPRESSION CONCURRENT COND CONDITION CONFIGURATION CONFLICT CONNECTION CONSISTENCY CONSTRAINT CONTAINS CONVERSION CONVERT CORRUPT CORRUPTED COUNT CREATE CREATION CRST CURRENT CURSOR DA DATA DATETIME DECIMAL DEFAULT DEFINED DEFINER DEFINITION DELETE DENIED DEPENDENT DEPRECATED DIFFERENT DISABLE DISABLED DISALLOWED DOES DOESNT DROP DUP DUPLICATE DURING EMPTY ENCRYPTION ENGINE ENTRY ERR EVENT EXCEEDED EXCEEDS EXCEPTION EXCHANGE EXECUTED EXECUTION EXIST EXISTS EXPLAIN EXTERNAL FAIL FAILED FAILURE FEATURE FIELD FIELDS FILE FILEGROUP FILES FILTER FILTERS FK FOR FORBIDDEN FOREIGN FORMAT FOUND FPARSER FRAME FULL FULLTEXT FUNC FUNCTION FUNCTIONAL GENERATED GEOJSON GEOMETRY GLOBAL GRANT GROUP GROUPING GRP GTIDS HANDLE HANDLER HAS HAVE HEADER HEARTBEAT HOST HYPERGRAPH IGNORE IGNORED ILLEGAL IMPLEMENTATION IMPLEMENTED IMPORT INCOMPATIBLE INCONSISTENT INCORRECT INCREMENT INDEX INFER INFO INIT INJECTION INNODB INSERT INSTALL INSTALLED INSTANT INSUFFICIENT INTERRUPTED INTERVAL INTO IS JDV JSON KEY KEYRING KEYS LANGUAGE LARGE LATITUDE LENGTH LIBCURL LIMIT LIST LOAD LOADER LOCK LOCKED LOGGING LONG LONGITUDE MALFORMED MANDATORY MANY MASKING MASTER MATCH MAX METADATA MISMATCH MISSING MODE MULTIPLE MUST NAME NATIVE NESTED NET NEXT NON NONEXISTING NONPARTITIONED NULL NUMBER OBJECT OF OFF ON ONLY OPEN OPERATION OPTION OR ORDER OUT OVERFLOW PACKET PARAM PARAMETER PARAMETERS PARENT PARQUET PARSE PARSER PARSING PART PARTIAL PARTITION PARTITIONING PARTITIONS PASSWORD PATH PERSIST PERSISTED PLUGIN POLICY POSITION PREVENTS PRIMARY PRIVILEGE PROC PROCEDURE PURGE PURGED QUERY RANGE READ READER READONLY REASON RECONNECT RECORD RECOVERY RECURSION RECURSIVE REDO REFERENCE REFERENCED REGEXP REGISTRATION REPLACE REPLICA REPLICATE REPLICATION REPOSITORY REQUIRED REQUIRES RESOURCE ROLE ROLLBACK ROTATE ROTATION ROUTINE ROW RPL RUNNING SAME SCHEMA SECONDARY SECURE SELECT SERVER SERVICE SESSION SET SETTABLE SIGNAL SIZE SKIPPED SLAVE SOURCE SP SPATIAL SPECIFICATION SPECIFIED SQL SRID SRS START STATEMENT STATISTICS STD STMT STOP STORE STORED STRING SUBOBJECT SUBPARTITION SUBQUERY SUCH SUPPORTED SWITCH SYNTAX SYSTEM TABLES TABLESPACE TARGET TEMP TEMPORARY TERMINATOR THAN THREAD TIME TIMEOUT TIMESTAMP TO TOO TRANSACTION TRANSACTIONS TRANSFORM TRG TRIGGER TRUNCATED TYPE UDF UNABLE UNEXPECTED UNIQUE UNKNOWN UNLOAD UNSAFE UNSTRUCTURED UNSUPPORTED UNUSED UPDATE USE USED USER USING UUID VALIDATION VALUE VALUES VAR VARIABLE VARIABLES VECTOR VERSION VIEW VIRTUAL WARNING WHEN WINDOW WITH WITHOUT WRITE WRONG'

/**
 * `@errno` starts a sequential range; each following entry consumes one code.
 * Comma-delimited entries hold a packed symbol and an optional SQLSTATE.
 * A trailing space represents 42000, the most common nondefault state.
 * Symbols begin with ER_ by default. ? means OBSOLETE_ER_, and ! leaves
 * the symbol prefix empty. Lowercase tokens
 * encode words, _ separates adjacent raw words and ~ encodes an empty word.
 * The decoder preserves entry order and alias precedence.
 */
export const PACKED_ERROR_TABLE = `@1000,\
?HASHCHK,\
?NISAMCHK,\
f,\
YES,\
gnxpu,\
gnxe,\
gnxDB,\
DBnxpl,\
DBoupl,\
?DBouok,\
DBouRMDIR,\
?gokpu,\
gFINDxyREC,\
gGET_STAT,\
?gGET_WD,\
gsq,\
gtxpu,\
puaqe,\
gviDIR,\
?gwuWD,\
CHECKREAD,\
?DISKqh,\
ovse 23000,\
?ctvCLOSE,\
ctvvi,\
ctvRENAME,\
ctvzy,\
puzf,\
?FILSORT_ABORT,\
?FORMaqe,\
GET_ERRNO,\
rfHA,\
seaqe,\
aFORMpu,\
aKEYFILE,\
OLD_KEYFILE,\
txASvk,\
OUTOFMEMORY HY001,\
ucttSORTMEMORY HY001,\
?yvEOF,\
CONnwc 08004,\
ucttRESOURCES,\
lwrbc 08S01,\
HANDSHAKEc 08S01,\
DBACCESSolc ,\
laolc 28000,\
fDBc 3D000,\
yxCOMc 08S01,\
lwtqc 23000,\
lwDBc ,\
eplc 42S01,\
lwec 42S02,\
tnUNIQc 23000,\
wrSHUTDOWN 08S01,\
lwpsc 42S22,\
zzpszwqr ,\
zzqrps ,\
zzSUMwq ,\
zzzknw 21S01,\
ylstIDENT ,\
ovFIELDNAME 42S21,\
ovKEYNAME ,\
ovpb 23000,\
zzpsSPEC ,\
ukc ,\
oyvg ,\
NONUNIQe ,\
bog ,\
tgPRIse ,\
ylsxsg ,\
ylsxsePARTS ,\
ylstse ,\
semzosaEXITS ,\
BLOBzfASse ,\
yllzFIELDLENGTH ,\
zzlrse ,\
READY,\
?NORMAL_SHUTDOWN,\
?GOTww,\
SHUTDOWNnf,\
FORCING_CLOSE 08S01,\
IPSOCKc 08S01,\
fxurn 42S12,\
zzpsTERMINATORS ,\
BLOBSlifTERMINATED ,\
TEXTFILEaREADABLE,\
puplc,\
sorp,\
lhrp,\
zzSUBse,\
gREMOVE_ALLpt ,\
goupsuase ,\
rtrp,\
zdezf,\
fxuyg,\
KILLolc,\
fxzzf,\
yllzwu,\
fywLOGFILE,\
easrqazy,\
easr,\
BLOBgqyog ,\
zzDBti ,\
zzeti ,\
yllzwq ,\
yxc,\
yxvd ,\
zzPARAMCOUNTykvd ,\
zzuhykvd,\
yxe 42S02,\
psxeTWICE ,\
bqrqjze,\
zbEXTENSION ,\
ethqyna ,\
vnpuqh,\
yxmnwu ,\
ylsxxz,\
ylsxpt,\
yllzROWSIZE ,\
STACK_OVERRUN,\
zzOUTER_JOINzc ,\
tqmzjrn ,\
gFINDyt,\
gINITIALIZEyt,\
ytfPATHS,\
ytpl,\
gtxLIBRARY,\
gFIND_DLpb,\
qkaoh,\
rbsbBLOCKED,\
rbaPRIVILEGED,\
uslkzg ,\
usalf ,\
usfta ,\
zdrp,\
gnxyg,\
zzzknwtvwj 21S01,\
gREOPENe,\
bzetttq 22004,\
vuc ,\
MIXttqrqjlipt ,\
toqq ,\
TABLEACCESSolc ,\
COLUMNACCESSolc ,\
rfqqqae ,\
qqzzrbuazg ,\
fxue 42S02,\
toeqq ,\
alfnb ,\
xxc ,\
?UNUSED1,\
?UNUSED2,\
ABORTINGno 08S01,\
tlueylsi 08S01,\
tlvicFROM_PIPE 08S01,\
tlFCNTLc 08S01,\
tlPACKETSucttub 08S01,\
tlUNCOMPRESSc 08S01,\
tlvic 08S01,\
tlviry 08S01,\
tlctvzy 08S01,\
tlzyry 08S01,\
ylstxq ,\
egqvBLOB ,\
egqvlrrm ,\
?UNUSED3,\
zzmzti ,\
zzsemz ,\
zzMRGe,\
ovyw 23000,\
BLOBsezxsk ,\
vagqytq ,\
ylsxROWS ,\
wcvase ,\
?fRAID_COMPILED,\
zdzxsejSAFEtf,\
seosaEXITS ,\
mpfxue ,\
mparh ,\
gDO_THISoxANym 25000,\
coxnd,\
coxwf,\
coxFLUSH_LOGS,\
?coxCHECKPOINT,\
NEW_ABORTINGno 08S01,\
?DUMParh,\
?FLUSHszmaCLOSED,\
?rnREBUILD,\
xa,\
xatlvi 08S01,\
xatlzy 08S01,\
FT_MATCHINGseaqe,\
squalbym,\
yxxyzn,\
CRASHEDtvUSAGE,\
CRASHEDtvREPAIR,\
ztanfwf,\
TRANSmfqh,\
?wzthxn,\
vxawl,\
lwvx,\
notc,\
vxyg,\
ylsxzgCONNECTIONS ,\
wuCONSTANTStw,\
sqWAITyi,\
sqeqh,\
vitwym 25000,\
?ouDBzwvisq,\
?nxDBzwvisq,\
zzARGUMENTS,\
fPERMISSIONyknxzg ,\
?UNIONxzjooDIR,\
sqDEADLOCK 40001,\
egqvFT,\
mgADDqc,\
fvtwj 23000,\
wjsbvt 23000,\
CONNECTykxa 08S01,\
?vgtvsz,\
czuEXECUTINGnb,\
zzUSAGE,\
zztrttnajwq 21000,\
gzdzwREADLOCK,\
MIXINGalf,\
ovln,\
zgsmREACHED ,\
SPECIFIClaolc ,\
LOCALzn,\
qpzn,\
fog ,\
zzzkqazm ,\
zzysqazm ,\
zmglxvi,\
gzetzHERE ,\
axvYET ,\
xaFATALcREADINGma,\
vxree,\
rlqpLOCALzm,\
zzpzDEF ,\
seREF_DOataeREF,\
OPERANDna 21000,\
xtf1wj 21000,\
yxxmqw,\
nuHELP_DB,\
?CYCLICvs,\
lrnt,\
rfvs 42S22,\
DERIVEDthqyALIAS ,\
wqREDUCED 01000,\
TABLENAMEalfHERE ,\
axvlqtf 08004,\
xcgqytq ,\
mxmotd ,\
?wzWASwl,\
?wzWASawl,\
yllzqaUNCOMPRESS,\
ZLIB_Z_MEMc,\
ZLIB_Z_BUFc,\
ZLIB_Zodc,\
CUTzkqrCONCAT,\
dylFEW_RECORDS 01000,\
dylsxRECORDS 01000,\
dtqykNOTNULL 22004,\
doducttvh 22003,\
!dodyr 01000,\
dzhOTHERqw,\
gld2COLLATIONS,\
?ouzg,\
REVOKE_GRANTS,\
gld3COLLATIONS,\
gldNCOLLATIONS,\
znsbaSTRUCT,\
yxmx,\
vxreSSL_PARAMS,\
?wrsbjwplqtf,\
dpsRESOLVED,\
lwvxUNTILnk,\
teSKIPvx,\
UNTILnkre,\
zztiqarn ,\
zztiqaCATALOG ,\
?dQC_RESIZE,\
lwFTmz,\
yxsemf,\
dHOSTNAME_WONT_WORK,\
yxSTORAGEpa ,\
donxx,\
tnUPDATABLEe,\
proq,\
tzuzxj,\
DUPLICATEDzkjys,\
yrzzzk 22007,\
?ylMUCHlryjCOLS,\
btvzd,\
zbPS,\
GET_ERRMSG,\
GETydERRMSG,\
yxyhZONE,\
dbyj,\
bmnxq,\
dlfueOVERFLOWED,\
CONFLICTING_DECLARATIONS,\
xbfvqnx 2F003,\
xblgpl ,\
xbosapk ,\
xboupp,\
xbxopp,\
xbLILABELtd ,\
xbLABEL_REDEFINE ,\
xbLABELtd ,\
xbUNINITzm 01000,\
xbBADSELECT 0A000,\
xbBADRETURN ,\
xbBADSTATEMENT 0A000,\
zdionre ,\
zdionTRANSLATED ,\
vgry 70100,\
xbzzfttARGS ,\
xbnktd ,\
xbNORETURN ,\
xbNORETURNEND 2F005,\
xblwobvg ,\
xblwobwq ,\
xbobtd ,\
xboblgtx 24000,\
xbobatx 24000,\
xbUNDECLAREDzm ,\
xbzzfttFETCH_ARGS,\
xbFETCHfod 02000,\
xbovuf ,\
xbovzm ,\
xbovnk ,\
xbovCURS ,\
xbglh,\
xbSUBSELECT_NYI 0A000,\
xmalfjSFuayp 0A000,\
xbVARCONDlcCURSHNDLR ,\
xboblcqw ,\
xbCASEaqe 20000,\
qfyllzpu,\
qflwqz,\
qfEOFjnc,\
qfcjug,\
qfEOFjyxug,\
zrfpm,\
?FRMyxys,\
zzts,\
NONUPDATEABLEmz,\
?zrwqDERIVEDzc,\
zrwqmt,\
zrwqzn,\
zrwqTMPTABLE,\
zrzzsn,\
dzrMERGE,\
dzrzxse,\
zrb,\
xbfouxb,\
?xbGOTOjHNDLR,\
yplgpl,\
yposapk,\
yptvzruayce,\
ypgmjwj,\
ypfxuwjjyp,\
fogqaps,\
DIVISIONmeZERO 22012,\
yrzzzkqaps,\
rfzkqays 22007,\
zrNONUPDmp,\
zrmppp,\
PROCACCESSolc ,\
RELAYipo,\
?PASSWDsk,\
yxybma,\
IOpcirnvi,\
mavePROHIBITED,\
FSEEKpo,\
maveFATALpc,\
ijze,\
iveyxpc,\
RELAYirq,\
fBINARYss,\
RESERVEDxx,\
?WSASpp,\
?DIFF_GROUPSvc,\
?fqrqavc,\
?ubzwvc,\
?ssPROHIBIT_CHANGINGtt,\
?fpuMAPPING,\
?zzMAGIC,\
PSsxuf,\
seun0,\
zrmr,\
zrMULTIUPDATE,\
zrfrtpssn,\
zrokMERGEzr,\
mgzg,\
XAER_NOTA XAE04,\
XAER_INVAL XAE05,\
XAER_RMFAIL XAE07,\
XAER_OUTSIDE XAE09,\
XAER_RMERR XAE03,\
XA_RBROLLBACK XA100,\
tovcqq ,\
vclrqqpo,\
vclrREVOKEpo,\
odylst 22001,\
xblwSQLSTATE ,\
STARTUP,\
soFROM_FIXEDwxROWSykzm,\
gnxzgzwqq ,\
zzzkqays,\
eDEFmk,\
xbovqw ,\
xbazmARG ,\
xbfRETSET 0A000,\
gnxqots 22003,\
?ppwiBREAKma,\
mayzwi,\
manxwiNEED_SUPER,\
?EXECxmzwtxob,\
xmqxftxob,\
ndalfjSFuayp,\
fogqazrps,\
xbfvp,\
yllzSCALE ,\
yllzPRECISION ,\
M_BIGGERyfD ,\
zzsqttxye,\
CONNECTykqcodxa,\
vgtvqcodxa,\
qcodxaotpk,\
qcodxqbgnx,\
qcodxqb,\
?gnxFEDERATEDe,\
ypjzzwn,\
STACK_OVERRUN_NEED_MORE,\
ylstBODY ,\
dgouogKEYCACHE,\
yllzDISPLAYWIDTH ,\
XAER_DUPID XAE08,\
oeqkud 22008,\
gzdzfejSFuayp,\
zrPREVENTzd,\
PSfvp,\
xbgwuAUTOCOMMIT,\
?svoi,\
zrFRMfzg,\
zrOTHERzg,\
fxuzg,\
FORBIDwnmj,\
wjsbvt2 23000,\
fvtwj2 23000,\
xblwzmSHADOW ,\
ypfoi,\
OLDpuqd,\
xbvpsm,\
?xbvcenu,\
xbzzti ,\
eNEEDS_UPGRADE,\
xbfld ,\
tbPREPAREDxmnwREACHED ,\
zrvq,\
tnqspszf ,\
egqvSPKEYS,\
fTRIGGERStvxywn,\
REMOVED_SPACES,\
ltvipp,\
USERNAME,\
HOSTNAME,\
zzxqsk,\
tnINSERTABLEe,\
ADMINzzMRGe,\
ylHIGH_LEVELttNESTINGqawq,\
tiBECOMESoy,\
AMBIGUOUSpsTERM,\
qcwrpl,\
qcwrotpk,\
rfHAnxtz,\
upwczlc,\
upzzzlc,\
upMAXVALUEc,\
?upxsc,\
?upSUBPART_MIXc,\
upzzfunc,\
upzzfSUBPARTc,\
zzEXPRjupqjc,\
?fCONST_EXPRjvhuasnc,\
psaqeunc,\
?snttpttwjHASHc,\
rkuprpc,\
upqjalfc,\
urthlxohc,\
vhaINCREASINGc,\
rkysttFUNCTIONSc,\
tgDEF_CONSTjsnunc,\
uppbc,\
MIXqwc,\
upaohc,\
ylsxurc,\
xsc,\
gnxqwpu,\
BLOBpsjunqjc,\
ywseNEED_ALLptjPF,\
fPARTSc,\
upMGMTtvtp,\
qcsetvPARTITIONED,\
ouuptnEXISTENT,\
ouLASTup,\
COALESCEtwtvHASHup,\
REORG_HASHtwtvwmf,\
REORGfufc,\
twtvvhsnup,\
ADDupSUBPARTc,\
ADDupfNEWup,\
COALESCEupfup,\
REORGupapk,\
wmtiup,\
fmac,\
CONSECUTIVE_REORGur,\
REORG_OUTSIDEvh,\
upqkpq,\
?unSTATEc,\
LIMITEDunvh,\
uwsbaLOADED,\
zzzk,\
fupqaGIVENzk,\
pvtztwONCE,\
nxpvpp,\
oupvpp,\
yalrEXTENDc,\
zzwxtr,\
wxudc,\
lhpvpp,\
mawjsspp,\
?mawjzzeDEF,\
?mawjRBRykSBR,\
pdlgpl,\
?pdxopp,\
pdosapk,\
?pdglh,\
?pdoupp,\
pdrzaPOSITIVEuayllz,\
pdENDSlySTARTS,\
pdEXECyhjTHE_PAST,\
?pdtxepp,\
?pdNEITHER_M_EXPR_NOR_M_AT,\
?mwnwottanv,\
?mgsoFROMe,\
?pdmgok,\
?pdCOMPILEc,\
pdwmti,\
?pdodylst,\
ournpz,\
donxxzwVER,\
?gzysqie,\
gsqie,\
qcowseOLDzc 23000,\
mwnwottaPLEASEzd,\
?yceuzxwucttRBR,\
xpqkuzxwmaqd,\
?NDBgxwmaqd,\
upfyd,\
upCONST_DOMAINc,\
upqksbalf,\
?DDLiczc,\
tqjzlLESSyf,\
zzupti,\
gmjTX_CHARACTERISTICS 25001,\
ovpbAUTOINCREMENT_CASE,\
?pdMODIFY_QUEUEc,\
pdwuzmc,\
upMERGEc,\
?gACTIVATEi,\
?RBRalu,\
BASE64_DECODEc,\
pdvpqb,\
?EVENTS_DBc,\
twINTEGERSlf,\
UNSUPORTEDipa,\
lwixj,\
gRENAMEie,\
zzPARAMCOUNTyktjFCT ,\
zzuhyktjFCT ,\
zzuhykxpFCT ,\
tjFCTtimy,\
ovpbzwseti 23000,\
maveEMFILE,\
pdmgnxjTHE_PAST,\
pdmglhjTHE_PAST,\
?wzINCIDENT,\
fupqaGIVENzkSILENT,\
mayzxj,\
maFATALc,\
?wzRELAYivipq,\
?wzRELAYizypq,\
?wznxpdpq,\
?wzszCOMpq,\
massIMPOSSIBLE,\
zrfnyCTX,\
zrbnyCTX,\
?SRbnyCTX,\
ypnvpu,\
ypfnyCTX,\
ypbnyCTX,\
pdbnyCTX,\
ypgtxe,\
?gnxSROUTINE,\
?NEVERzf,\
fqdDESCRIPTIONpdlymaxj,\
vxnupd,\
?soodbmzzc,\
ivefpu,\
XA_RBTIMEOUT XA106,\
XA_RBDEADLOCK XA102,\
NEED_REPREPARE,\
?DELAYEDaxv,\
!dfnotc,\
!dtzre,\
uwokBUILTIN,\
!duwBUSY,\
znsbvk,\
dpaymwf,\
?wzrapq,\
vxrazkucttvh,\
NDBvzwnc,\
nnFNukc,\
EXCEPTIONSzyc,\
ylstenc,\
ylstpsnc,\
qjINEXISTENTtimy ,\
DATABASEti,\
eti,\
upti,\
xsti,\
ydti,\
RENAMEDti,\
ylsxnjTRXS,\
!dtnASCII_SEPARATORarh,\
DEBUG_SYNCyi,\
DEBUG_SYNC_HITsm,\
ovwwwu ,\
wwd 01000,\
wwaqe 02000,\
wwpg,\
RESIGNALzxlbqw 0K000,\
wwlwnlys,\
!dnkITEMyr,\
nkITEMylst,\
yxLOCALE,\
vxrdwrIDS,\
?vgmfoq,\
wmtiupps,\
upmzsnc,\
zzysmzzkc,\
ylsxupqjptc,\
MAXVALUEjzlj,\
ylsxzlc,\
wjSINGLEuppsc,\
psysalfASupps,\
upptylst,\
mawjpalixmpa,\
mawjtflixmpa,\
mayzlixmpa,\
mawjrrlixmpa,\
maxmtfliwjpa,\
mawjrrlixmtf,\
matgENGINESliSELFsspa,\
mayzsm,\
?UNUSED4,\
mayzxye,\
mayzltna,\
mayzyt,\
mayzxyzn,\
mayzxyqk,\
mayzNONTRANSlcTRANS,\
MESSAGElixj,\
?wznspp,\
vxgnxns,\
INSIDEymuzxwmaqd,\
utsk,\
donxxfREPLACEMENT,\
zztjeSTRUCTURE,\
zzPERFSCHEMA_USAGE,\
dI_Swye,\
INSIDEymuzxwmaDIRECT,\
xpqkuzxwmaDIRECT,\
xcthqyGEOMmw ,\
ylstrnnc,\
sqABORTED,\
oducttvh 22003,\
?zzSPVARysjsm,\
mayztgENGINESliSELFsspa,\
mayzMIXEDxj,\
INSIDEymuzxwxfiBIN,\
xpqkuzxwxfiBIN,\
ppviFROM_PARpu,\
zlsbaINTysc,\
laolfusc 28000,\
?wuuslquw,\
?qquwzgpl,\
TRUNCATErfpz ,\
uwsbPERMANENT,\
vxrazkucttvhMIN,\
vxrazkucttvhtb,\
xmmfqh,\
MULTIzdsenn,\
eNEEDS_REBUILD,\
!dtzBELOWsm,\
rnmzylst,\
cjyqBODY,\
cjyxyqBODY,\
rnnu,\
UNDOvnyllz,\
mayzrtrdwq,\
mayzrtwqzd,\
mayzvwwq,\
mayznxrdwq,\
mayznxvwwq,\
mayzzdrd,\
uwfUNINSTALL,\
uwfru,\
mayzzyltwq,\
mayznxwqlt,\
mayzrtTWOsg,\
ejpzmp,\
zbpa,\
mayzltaFIRST,\
mgsoFROMeV2,\
xaDELAYzkucttvh,\
twFDliRBR_EVENTSlfjmaxj,\
upphootz,\
upphune,\
upphyce,\
upINSTEADttxs,\
yxup,\
xzootc,\
wjosataup,\
mamfwxGREATERyftb,\
drnaAPPLICABLE,\
upphqcse,\
?fxusezk,\
wkrpodylst,\
?NETWORKvipdmrpq,\
?mavipdmrpq,\
maxmmfwxGREATERyftb,\
gzdejnxewq,\
upmttvtp,\
wjosataGIVENupwu,\
?fxuup~zc,\
mjwkrpwapq,\
ztanfwfzwCREATEDyce,\
ztanfwfzwDROPPEDyce,\
MTAprsbaxv,\
MTA_UPDATED_DBS_GREATERtb,\
MTAgPARALLEL,\
MTArkod,\
qiaxvzwuq,\
ocbnltr 35000,\
INSECURE_PLAIN_TEXT,\
INSECUREmjxa,\
qcowsezwmsrp 23000,\
qcowsezxmsrp 23000,\
SQLTHREADzwwpvx,\
eqxfFT,\
znawvjSFuayq,\
znawvjym,\
?ktmsbajktmsn,\
?gmjktmjym,\
wuxjmgINVOKEqk,\
ktmglxAUTOMATIC_IFktmsnsbtntq,\
?SKIPPING_LOGGEDym,\
svkwuxd,\
svkwuENCODING,\
svkxd,\
GNO_EXHAUSTED,\
lwvxlruy,\
lruywcktfatu,\
gDO_IMPLICITndjTRXzuktmsbwu,\
ktftvwcENFORCEknptv,\
?ktfwcma,\
gwuktmykkzuktfsbtu,\
gwuktmyklkzuktfsbtv,\
gwuktmsnyktntqzuktfsbtu,\
?qekpdzuktfsbtu~zc,\
kyztnTRANSACTIONALe,\
kyznxwq,\
?kyznxouycejym,\
ktfCANtwmjONE_STEP_AT_Ayh,\
xaqxvfwbqu,\
gwuktmzuOWNINGk,\
yxpmqd,\
gEXECUTEjvitwym 25006,\
ylsteupnc,\
vxnm,\
rsFTsm,\
rsfFTyce,\
rsFTzzDOCIDmz,\
rsFTzzDOCIDrn,\
rsONLINEiyllz,\
yxlhle,\
yxlhsq,\
MTAmjxagRUNzwGAPS,\
MTAvopq,\
MTA_RESET_WORKERS,\
mwnwottanvV2,\
vxSILENT_RETRYym,\
DISCARDpzmqwl,\
ewntd,\
ejxyya,\
IOvic,\
IOzyc,\
yate,\
yapl,\
yaDISCARDED,\
INTERNALc,\
rsric,\
rsrnnu,\
bYEARmzsk,\
aVALIDus,\
thmjus,\
pzfrnms,\
pzfrnui,\
pzpoADDxy,\
pzmgtxui,\
pzrltz,\
pzovti,\
usqd,\
pzmzmgou,\
pzmzmgoums,\
pzmzatq,\
ovrn,\
pzmzmgmj,\
pzmzmgmjms,\
?UNUSED5,\
svue,\
vitwtf,\
ktmysUNDEFINEDk,\
znawvjxb,\
?gwukvfzuktfsbtu,\
gwukvfzukpisbaoy,\
gwukvfzuOWNEDqusbaoy,\
kvfWASmk,\
kpiWASmk,\
maxmtflifREPLxz,\
lhtyaxv 0A000,\
lhtyaxvvl 0A000,\
lhtyaxvvlCOPY,\
lhtyaxvvlup,\
lhtyaxvvlpzRENAME,\
lhtyaxvvlmzys,\
lhtyaxvvlpzmp,\
?UNUSED6,\
lhtyaxvvlNOPK,\
lhtyaxvvllt,\
lhtyaxvvlHIDDEN_FTS,\
lhtyaxvvlmjFTS,\
lhtyaxvvlFTS,\
?xfvxSKIP_COUNTERawvjktf,\
ovyxjrn 23000,\
IDENT_CAUSESylstut,\
lhtyaxvvlatq,\
thmjusLOGIN,\
wjjzzup,\
MTApdBIGGER_PENDING_JOBSwxtb,\
?rsfFT_USESul,\
maLOGICAL_CORRUPTION,\
dveijze,\
dveisblb,\
lrrmnn,\
!dtvBLOCKHOLEjRBR,\
vxCMrqwa,\
vxAMrqwa,\
laolmjzgc 28000,\
rsvitw,\
xnvxxfygyi,\
xnvxIOygyi,\
enu,\
ycpuzypq,\
rsFT_AUXaHEX_ID,\
OLD_TEMPORALS_UPGRADED,\
rsFORCEDvo,\
AESbIV,\
uwmglxUNINSTALLED,\
kyzmaSPLITTABLExjliASSIGNEDk,\
vxqxMOREquyfxa,\
tese,\
!dNAMED_PIPElaEVERYONE,\
@3000,\
punu,\
ctvxa,\
?rkc,\
STORAGEpaaLOADED,\
GET_STACKEDoczxlbqw 0Z002,\
dLEGACYxxCONVERTED,\
mayzqiuw,\
mgDISCARDyde,\
pzDEPTHpe,\
mwnwottaPLEASEzdV2,\
dyqotqyCREATED,\
vtyposapk,\
pmaxv,\
bpswx,\
teHAnxtz,\
paucttMEMORY,\
usEXPIRElkzg,\
vxxfygthxn,\
fFT_MATERIALIZEDxt,\
rsUNDOiqh,\
blnqaLOGARITHM 2201E,\
vxmlIOygthxn,\
dtxycxzthlxZERO,\
dtwxaipufPOS,\
vgyi,\
tnROwqopTIMER,\
ovsnpb,\
?xftffEFFECT,\
ldubqaUNION,\
ldubtnAGGvg,\
vxWORKER_STOPPED_PREVIOUS_THDc,\
?DONT_SUPPORTvxPRESERVEndub,\
wrOFFLINEtf,\
GISooSRIDS,\
GISzbln,\
GISyxc,\
GISyxpg,\
GISbod 22023,\
mbqooyINPUTpg,\
mbqoCENTROIDpg,\
mbqoOVERLAYbINPUTpg,\
mbqoTURNrppg,\
mbqoSELF_INTERSECTION_POINTpg,\
mbqoyxpg,\
xllwALLOCc,\
xlDOMAINc,\
xlskc,\
xlbln,\
xlucttvhc,\
xludc,\
xlvhc,\
xlUNDERFLOWc,\
xlLOGICc,\
xlRUNTIMEc,\
xlyxpg,\
GISodzzENDIANESS,\
mjxaussk,\
zgsqzzti ,\
zgsqDEADLOCK,\
vwINACCESSIBLE_ROWS,\
lhtyaxvvlGIS,\
rfzgzm ,\
ktftu,\
?zbmevzyg,\
rlys,\
psjubawq,\
ldjubawq,\
bwkWILDepxPATTERN,\
tlOKueylsi 08S01,\
bsdod,\
bqnteMEMBER,\
bqnzzys,\
bqnUNSPECIFIED,\
DIMENSIONzb,\
vxmlosapk,\
?wztgmmrbPORT,\
vxmltibuaylst,\
vxNEWmlzzwa,\
?wzmlok,\
vxtgmmCMD,\
vxtbmmpe,\
vxmlthxn,\
vxmlawl,\
vxmlWASwl,\
vxmlWASawl,\
vxmlxfygthxn,\
vxmlxfSKIP_COUNTER,\
zzpszwqrV2,\
MIXttqrqjliptV2,\
donSYSVARzd,\
donSQLMODE,\
mgiuoouDATABASEzwk,\
qrvznm,\
qrvzwl,\
qrvzllrqc,\
qrvzxnllygyi,\
qrvzneLAYERwtc,\
qrvzneLAYER_JOINc,\
lyDMLzjc,\
uzznzxRBR,\
RUN_HOOKc,\
ymwfoxnd 40000,\
qmmzqksbalf,\
zblhINPLACEtvzsmz,\
zzpztzqaqmmz,\
tnogzkqaqmmz,\
zbACTIONtvqmmz,\
qmmztnPRIOR,\
ommeqmmz,\
qmmzREFlrINC,\
pralu,\
gwuktf,\
gzelruyzwktftu,\
?gvylkzwlruy,\
?gvylkzwktftv,\
?gvykzwktftu,\
gENFORCEknpzwONGOINGkVIOLATING_TX,\
ENFORCEknpdzwONGOINGkVIOLATING_TX,\
ACCOUNTqxBEENsr,\
zzyati ,\
yasbaoy,\
zzputi,\
mbqorkTURNSpg,\
dOPTIMIZER_HINTxxc,\
dlwtbpjyh,\
dzbtbpjyh,\
dCONFLICTING_HINT,\
dyxQBti,\
UNRESOLVED_HINTti,\
dtvMODIFYINGkpie,\
PLUGGABLE_PROTOCOLnbaxv,\
LOCKINGwszzti ,\
LOCKINGwsDEADLOCK,\
LOCKINGwsyi,\
GIStbPOINTSjqoOVERFLOWED,\
xftfMERGED,\
?VTOKENuwTOKENtd,\
?VTOKENuwTOKENaqe,\
gwuznzuOWNINGk,\
vxmltyalf,\
bsdTEXT 22032,\
bsdTEXTjuf 22032,\
bsdBINARYod,\
bsdut ,\
bsdmo 22032,\
bsdmojqk 22032,\
bysqasd 22032,\
bCASTyksd 22032,\
bsdutmo ,\
bsdutWILDCARD ,\
sdzkyllz 22032,\
sdseyllz 22032,\
sdzfASse ,\
sdVACUOUSut ,\
sdlwONEuaALL_ARG ,\
NUMERICsdzkucttvh 22003,\
bsdzkqaCAST 22018,\
sdDOCUMENTylDEEP 22032,\
sdDOCUMENTtqse 22032,\
wpTRANSPORTwb,\
fwpTRANSPORTS_CONFIGURED,\
oqSTORAGEpa,\
zgosapk,\
zglgpl,\
lpAPI_ABORT,\
bsdutARRAY_CELL ,\
BUFPOOL_RESIZE_INPROGRESS,\
proqSEE_DOC,\
wrISNTlu,\
wtWAS_KILLED,\
mhpe,\
mhpejvhOPTIMIZER,\
?eNEEDS_UPGun,\
gWAITqapikwuWHILE_OWNING_Ak,\
mgADDqcBASEmwzs,\
mgnxzsrnnq,\
ctvMODIFYINGkpie,\
sqREFUSEDmepa,\
zblhONLINEtvzsmz,\
szsewhaxvmeSE,\
?szsewhcmeSE,\
szsewhmapp,\
szsewhSE_UNAVAILABLE,\
yamgENCRYPT,\
boztz,\
mgFINDsejsf,\
mhpejul,\
zblhozINPLACE,\
sfytsfwsc,\
zgmzOLDsk,\
gRESETxa,\
qrvztbqrwx,\
mgADDqcBASEmwxp,\
evt,\
?uppaonqae,\
?dzhGEOMFROMWKBykwuxgZERO 01000,\
?dzhGEOMFROMWKBykwuxg 01000,\
XA_RETRY,\
sfAWSytAWS_KMSc,\
mayzXA,\
ytc,\
sfMIGRATIONpq,\
sflaolc ,\
sfMIGRATION_STATUS,\
?uwppyktxxz,\
?uwppyktxe,\
?lpifsfuwrv,\
?lpiozusqxaBEENwu,\
?lpiCOULDanxAESse,\
?lpiozusmglxFETCHED,\
?lpisdFILTERINGaENABLED,\
?lpiytrxvb,\
?lpiSUPERvbwb,\
?COULDaREINITIALIZElpipy,\
?lpiytblnys,\
?lpiytblnnw,\
?lpiqxaBEENrv,\
?lpiytvibtbARRAYskARGys,\
lpiytvibtbARRAYskARGzk,\
?lpisdpxumc,\
?lpisdpxtimglxoy,\
?lpisdzgtimglxoy,\
?lpisdpxosapl,\
?lpizgFIRSTmnthlxALPHANUMERIC,\
?lpizgtibmn,\
?lpirbtibmn,\
!OBSOLETEdonMAXDBxftfqayj,\
?XAvzpy,\
?gtxci,\
?qstvyjjDST,\
?gxiwrNAMED_PIPE,\
zywupfsm,\
?onTLSzqwt57,\
?donTLSzq57,\
?dzztjeSTRUCTURE,\
AESbKDFti,\
AESbKDF_ITERATIONS,\
!dAESsewx,\
AESbKDFtzwx,\
@3500,\
UNSUPPORT_COMPRESSEDyde,\
ACLtypp,\
zbrnle,\
fxuDB 42Y07,\
yllzENUM,\
ylstwuENUMzk,\
bDDts,\
UPDATING_DDe,\
bDDtsID,\
bDDtsti,\
yatezwti,\
ylstwinc,\
xbsopp,\
bBITWISE_OPERANDSwx,\
bBITWISEldOPERANDSwx,\
dzbHINT,\
yvqoys 22S01,\
xhukc SR002,\
xhPROJugte SR003,\
dxhaqe 01000,\
xhami 22S00,\
xhamiUNDEFINED SR001,\
PKrnglxINVISIBLE,\
yxAUTHID,\
ppweqq,\
txwexz,\
ppogROLES,\
nhfSCHEME,\
nhfSCHEMEws,\
nhgso,\
weaGRANTED,\
ppREVOKEwe,\
RENAMEwe,\
nhgACQUIREwsrg,\
nhgSATISFY_DEPENDENCY,\
nhsogREGISTERwsrg,\
nhsogINITIALIZE,\
nhyyaLOADED,\
nhyygDEINITIALIZE,\
nhgRELEASEws,\
nhyygUNREGISTERws,\
nhgyy,\
dyyTHEauv,\
ngerl,\
ngMANIPULATEwjpp,\
nhyyowjqr,\
gwukvfDUE_SETS_CONSTRAINTS,\
mgsqzgMANAGEMENT_CACHES,\
xhaqe SR001,\
znauv,\
sbvgbmt,\
yuykxoxk,\
fxywnla,\
fxyyala,\
fxyela,\
fxyelaqaDICTIONARYe,\
fxyelaqaxye,\
fxyelaqae,\
btzse 22023,\
btzzk 22023,\
btzsezkPAIR 22023,\
btzximn 22023,\
btzENDmn 22023,\
btzCHARACTERS 22023,\
owtzse 22023,\
dxhaqeAXISub 01000,\
flayktjFCT,\
RESETxaykzkucttvh,\
UNRESOLVEDesq,\
owesq,\
mayzSKIPsr,\
mayzNOWAIT,\
sqNOWAIT,\
CTEvqwcUNION,\
CTEvqwcNONRECURSIVE_FIRST,\
CTEvqFORBIDS_AGGREGATION,\
CTEvqqbJOINub,\
CTEvqwcSINGLEvs,\
xwTMPpa,\
zvfxuzv,\
zvCIRCULARITYjzvGRAPH,\
zvfmsuq,\
zvfINHERITqg,\
zvfREDEFINEubme,\
zvqgxirf,\
zvqgENDrf,\
zvqgrf,\
zvvhqgubys,\
zvvhqgTEMPORALys,\
zvvhqgNUMERICys,\
zvvhBOUNDaCONSTANT,\
zvowti,\
zvrfubme,\
zvbzvqjze,\
zvbzvqjALIASze,\
zvtkzvqjzejzvSPEC,\
zvROWSrzze,\
zvfqrubzc,\
zvpmsd,\
zvqkIGNORESqg,\
WL9236_NOWzc,\
bfttARGS,\
psjqsaqrme,\
ylstyanc,\
pagoue,\
pagoutee,\
yaovFILENAME,\
DBouRMDIR2,\
IMPfpwMATCHED,\
IMPwnosapk,\
IMPelgpl,\
IMPrjMYSQLDzq,\
IMPrjDDzq,\
IMPrjSDIzq,\
dbHINT,\
zmosapk,\
suucttvh 22S02,\
sjucttvh 22S03,\
arhqaGEOGRAPHICxh 22S00,\
rfvbLEVEL,\
fxyzrla,\
ngpxFLABBERGASTED,\
unEXPRylst,\
ytouDYNAMICALLY_REGISTERED,\
yuykxomzxk,\
yuykzdmzxk,\
yuykoumzxk,\
yuykBUILD_HISTOGRAM,\
swwe,\
teyapu,\
uutwlaolc ,\
?CMD_NEED_SUPER,\
utjDATADIR,\
mvDDLjPROGRESS,\
mvylsxnjCLONES,\
llipdzjc,\
CTEtbvpDEPTH,\
aHINT_UPDATABLEzn,\
CREDENTIALS_CONTRADICTykHISTORY,\
ztusHISTORY_CLAUSES_VOID,\
muosaSUPPORT,\
I_Swyya,\
yapatd,\
zzxgqamz,\
mglhxgDUEykrn,\
dmauoUPDATESoq,\
?dmaV1wjEVENTSoq,\
dmauoUPDATES_SUGGESTSuoIMAGES,\
COULDaAPPLYsdDIFF,\
nvsdDIFF,\
wdqrpl,\
wdqrapl,\
bVCPU_ID,\
bVCPUvh,\
bygPRIORITY,\
orty,\
wdqrBUSY,\
wdqroq,\
przb,\
lore,\
bygID,\
wdqrBINDpp,\
bzettFORCEtz,\
qrvznbpq,\
SDItypp,\
tesdezk 22035,\
zzsdezk 2203F,\
TFthqyALIAS ,\
TFqbJOINys,\
JTzkucttvh 22003,\
JTtbtkut ,\
usEXPIRATIONaxvmelqMETHOD,\
bqnCRSaTOP_LEVEL,\
lwtqcare 23000,\
!dUSELESSxcrn,\
DISKqhNOWAIT,\
ukcjDIGEST_FN,\
UNDISCLOSEDukcjDIGEST_FN,\
wnDIRpl,\
wnDIRte,\
wnDIRnxpp,\
wnDIRyx,\
twrhqaxg0li4326 22S00,\
?maEXPIREiDAYSliSECSzfTOGETHER,\
vumcud,\
vurfln,\
vurnOUTOFBOUNDSc,\
vuINTERNALc,\
vuRULExx,\
vulwESCAPE_SEQUENCE,\
vuUNIMPLEMENTED,\
vuMISMATCHED_PAREN,\
vulwrz,\
vutbLT_MIN,\
vubBACK_REF,\
vuLOOK_BEHINDsm,\
vuteCLOSE_BRACKET,\
vubvh,\
vuSTACKud,\
vuyhuc,\
vuPATTERNyllz,\
gwuciws,\
oyPIPELINEqaciws,\
ngpxDIAGNOSTICS,\
arhqamixh 22S00,\
arhqaPROJECTEDxh 22S00,\
NONPOSITIVE_RADIUS 22003,\
RESTARTwrpp,\
xhteswlo SR006,\
xhtgloDEFINITIONS SR006,\
xhtiglxoyuaWHITESPACE SR006,\
xhORGANIZATIONglxoyuaWHITESPACE SR006,\
xhIDlgpl SR004,\
dxhIDlgpl 01S00,\
gMODIFYxg0 SR000,\
dRESERVEDxgvh 01S01,\
gMODIFYxhzfmemz SR005,\
xhbmnjlo SR006,\
xhloxqylst SR006,\
onUTF8_ALIAS,\
onNATIONAL,\
bogUTF8MB4mx,\
yuykCOLLECTiSTATUS,\
RESERVEDyati,\
yuykwutz,\
vxPOSSIBLY_DIVERGEDlcDDL,\
xhaGEOGRAPHIC 22S00,\
POLYGONylsi 22023,\
xcywrn,\
rnysaxvqaxcrn,\
pzmgouui,\
qoufsuucttvh 22S02,\
qoufsjucttvh 22S03,\
pzmgzezsmz,\
pzfmzui,\
gwucSUPPRESSIONsn,\
xhGEOGCSbAXES SR002,\
xhbSEMI_MAJOR_AXIS SR002,\
xhbINVERSE_FLATTENING SR002,\
xhbANGULAR_UNIT SR002,\
xhbPRIME_MERIDIAN SR002,\
yoxaxhaxv 22S00,\
yoybxhaxv 22S00,\
yoxaxhteTOWGS84 22S00,\
yoybxhteTOWGS84 22S00,\
yceuzxwwtmaqd,\
yceuzxwqpmaqd,\
wllluzxwqpmaqd,\
mukyznxouycejTRXjSBR,\
?XAgnxMDL_BACKUP,\
ezxPK,\
dodyrqlrn 01000,\
doducttvhqlrn 22003,\
qlrntvsduaqoqk ,\
qlrnREFlrrm,\
mgoumzqlrn,\
qlrnvase,\
qlrntvLOB,\
qlrnqksbalf,\
qiqlrn,\
xcqlrn,\
zzsemzqlrn,\
qlrntvps,\
qmmzNAMEDqksbalf,\
qmmzwjzk,\
qmmzzo,\
ommeogqmzk,\
ogVALqmtnPRIOR,\
ogVALqmREFlrINC,\
ogVALqmqksbalf,\
ogVALqmNAMEDqksbalf,\
ogVALqmwjzk,\
ogVALqmzo,\
ogAS_VALqm,\
zbACTIONtvogVALqm,\
kyzlhADDmwzwogEXPRESSION,\
pzmgmjpa,\
donzgwuEXPR,\
donUTF8MB3mx,\
dontkncxx,\
pzrjna,\
GR_HOLD_WAITyi,\
GR_HOLD_KILLED,\
GR_HOLD_MEMBER_STATUSc,\
wkozppykFETCHse,\
wkozseaqe,\
wkozsfbse,\
wkozqzc,\
wkozppykwgLOGS,\
wkozseplyv,\
wkozppykGENERATEse,\
wkozppykxose,\
wkozppykREMOVEse,\
wkozyuykmjtz,\
wkozszsevopp,\
SLOWitfrezuassykpu,\
qtTRXnpalf,\
qtTRXnply,\
qtTRXnplctvTRX_BEGIN,\
qtTRXnpBEGINalf,\
qlrnwjzksbalf,\
wkozppykENCRYPT,\
PAGE_TRACKINGaSTARTED,\
PAGE_TRACKINGvhaTRACKED,\
PAGE_TRACKINGmgve,\
wkozmgwgmaszse,\
maszsevoucttCOMBINATION,\
maszsewhpoykOPERATEse,\
maszsewhpoykwgLOGS,\
maszsewhpoykREENCRYPTi,\
maszsewhpoykCLEANUPzcsg,\
maszsewhpoykCLEANUP_AUXse,\
tnBOOLEAN_EXPRqampnq,\
mzmpnqREFERENCES_OTHERmz,\
mpnqNAMEDqksbalf,\
mpnqqksbalf,\
mpnqzo,\
mpnqwjzk,\
mpnqREFERSlrrmmz,\
mpnqVIOLATED,\
mpnqREFERSyxmz,\
mpnqaqe,\
mpnqovti,\
mpnqmtzhpzREFER_ACTIONmz,\
!dUNENCRYPTEDejENCRYPTED_DB,\
bozREQUEST,\
mgwueoz,\
mgwuDATABASEoz,\
mgwuyaoz,\
yamglxENCRYPTED,\
yamglxDECRYPTED,\
yaysyx,\
ybyaUNENCRYPTED,\
mgzeozmt,\
btgCLAUSES,\
zbzettqqAS,\
UKNOWNlqIDualaolqaqqAS,\
ommeqlrn,\
uwaEARLY,\
rsvrilmxiSUBDIRut,\
rsvrilmxiyi,\
rsvrilmDIRSb,\
rsvrilmLABELaqe,\
rsvrilmDIRoy,\
rsvrilmfxuDIR,\
rsvrilmDIR_CLASH,\
rsvrilmDIR_PERMISSIONS,\
rsvrilmpunx,\
rsvrilmlb,\
rsvrilmINACTIVE,\
rsvrilmpp,\
rsvrilmwt,\
xlREGEXc,\
bsdys 22032,\
mgntxq,\
ommeupqj,\
donFLOATlrrm,\
wkgxnvxWHILEsrBACKUP,\
donFLOAT_DIGITS,\
donFLOAT_UNSIGNED,\
donINTEGER_DISPLAY_WIDTH,\
donZEROFILL,\
mvDONOR,\
mvPROTOCOL,\
mvDONORzq,\
mvOS,\
mvPLATFORM,\
mvmo,\
mvCONFIG,\
mvSYS_CONFIG,\
mvuwta,\
mvLOOPBACK,\
mvoz,\
mvDISK_SPACE,\
mvjPROGRESS,\
mvor,\
mgqqROLESyklkzg,\
wopauw,\
SECONDusmglxoy,\
DBlaol,\
oclqIDzwxyzgPRIVjswROLES,\
ocwkkemgtx,\
qojyxskUNIT SU001,\
ocuwruc,\
fwtyc,\
ocyxctr,\
mzmjwx,\
vubCAPTUREqrti,\
ocSSL_LIBRARYc,\
wopa,\
wopaDDL,\
rloaus,\
teoaus,\
oausawb,\
usmglxRETAINEDtvuwmj,\
oausmglxRETAINED,\
uoREVOKESpk,\
mgqqxyPRIVykswwe,\
XAvzpy,\
zbxftf,\
vubFLAG,\
uoREVOKEliDBqqBOTHpl,\
UNITaqe SU001,\
bsdzkqaqjrn 22018,\
sdzkucttvhqaqjrn 22003,\
peMVsgNUM,\
peMVsgSPACE,\
qlrnodsbylst 22001,\
zzMVIzk,\
dqjrnaAPPLICABLE,\
qtwkytc,\
zdkvfzwGR,\
qstvyjjDST,\
etiCAUSESylstut,\
lpirxvb,\
?lpiusqxBEEN_COPIED,\
ocqtwkSTARTEDlrREJOIN,\
SYSVARmjoxvg,\
GLOBSTATmjoxvg,\
qtwkMESSAGEwsrqpq,\
mjxazznilemu,\
mjxazzniLEVELmu,\
zznilemu,\
zzniLEVELmu,\
mjxazznilesnmu,\
muvbmqzgmglxlk,\
muvbmqzgosapk,\
muvbmqzgnu,\
muvbmqzgNEEDSwkllPRIV,\
docvbaREGISTERED,\
musfytseb,\
musfytseysb,\
musfytseylst,\
musfytseysylst,\
sdwnzjczwDETAILED_REPORT,\
ocytbmoxe,\
ocytbmo,\
ocytbmx,\
ocytbEXTENSIONlnys,\
tgCONSTRAINTSzwwmti,\
nqaqe,\
lhnqENFORCEMENTaxv,\
ezkCONSTRUCTORthqyna,\
ezkCONSTRUCTORmgqyog,\
muvgpqbtnwjqd,\
REQUIREwjqdbzk,\
ppykDETERMINE_IFwesbsw,\
ppykFETCHswwesn,\
muLOCALpwoq ,\
IMPrjCFGzq,\
ocOOM,\
ocytblnykwumo,\
ocytbRETURNysykwumo,\
tgsaCLAUSES,\
MISPLACEDsa,\
zglaolqazgACCOUNT_BLOCKEDmeussq,\
donYEAR_UNSIGNED,\
mvNETWORKue,\
SDItypptevn,\
ommempnq,\
qttyalfGRthxn,\
donsdetvctvoy,\
donINNERsa,\
donzlqkALWAYStq,\
donxfCALCqeROWS,\
donqeROWS,\
tesdzk 22035,\
tgsdzl 22034,\
HOSTNAMEylst,\
?dmuonupPREFIXse,\
qrvzzgoyMSG,\
qrvzzgswMSG,\
qrvzussk,\
xtyoREJECTED,\
ocqtwkvoENDPOINTqd,\
ocqtwkvoENDPOINTb,\
zzzkqazmPLUS_ACTIONABLEun,\
xjalflcxiym,\
qcsezwATOMICnxwq,\
alfzwxiym,\
bsdlo,\
paloaxv,\
bzglosd,\
rsvroq,\
rsvrARCHIVING_ENABLED,\
MDLucttRESOURCES,\
IMPLICIT_COMPARISONqasd,\
qkosaSUPPORTmnwu,\
IMPOSSIBLExqns,\
wnvitw,\
wkASYNCvmktftu,\
wkASYNCvmlruytu,\
opktfwcASYNCvmtu,\
oplruywcASYNCvmtu,\
bugze,\
mnwutd,\
dzmzkmjaxv,\
byhZONErz,\
bCAST,\
rcaxvYET ,\
?drcEXPERIMENTAL,\
ocfciulCONFIGURED,\
occieoq,\
occitgpy,\
ocgtxci,\
zgvtASoi,\
mgzgvtASoi,\
REGEXtryllz,\
SPVAR_NONINTEGERys,\
!dzbACLxzvi,\
mayzACLevijDML_DDL,\
xnvxMONITOR_IOygyi,\
STARTINGvxMONITOR_IOyg,\
gzelkykkzwktfatv,\
gCOMBINElkykkliAUTOPOSITION,\
ASSIGNquyklkynwcktftv,\
xfvxSKIP_COUNTERzfzwktftv,\
zhASSIGNquyklkynAS_LOCALuazi,\
?wukykANONliWAIT_UNTILxfTHDlcqu,\
gwuxflcualyquzwlkykk,\
lkykkziwmASqrti,\
gzewmziASqrti,\
qtwkvomlSTILLwl,\
rsblswxzk,\
rsrjzwya,\
rslswxucttvh,\
mgzelswxmt,\
weGRANTEDykITSELF,\
ethqyA_VISIBLEmz,\
rsnipq,\
dASYNC_CONN_FAILOVER_NETWORK_NAMESPACE,\
muINTERACTIONyi,\
bCASTykqo 22S01,\
bCAST_POLYGON_RING_DIRECTION 22S04,\
GISooSRIDS_AGGREGATION 22S05,\
RELOADsfpq,\
SDI_GETsgbya,\
mjwkSRCzznilewx,\
?donTLSzqqamlCLI,\
gzewmziASzrmjzi,\
lkykkziwmASzrmjzi,\
qtwkzrmjzipoGETzn,\
dADUITitbwxliPRUNE_SECONDS,\
dADUITitbwxCLOSEykwgtvwx,\
KERBEROSnxzg,\
ruuwnnmu,\
occingFLUSHpp,\
dxflcMTS_GAPS_GAPaCALCULATED,\
bASSIGNMENTyb ,\
tyalftvGRwo,\
qtwkFAILOVERmlSTATUS_PROPAGATION,\
dlpiqdUNIXyjtwzusd,\
bMFAuwxe,\
IDENTIFIEDmezb,\
buwqavv,\
uwwcvv,\
MFA_METHODpl,\
MFA_METHODapl,\
AUTHENTICATIONuxtd,\
uwvvDONE,\
bzgqavv,\
zgvvpp,\
MFA_METHODSbub,\
MFA_METHODS_IDENTICAL,\
bMFA_OPERATIONSqaPASSWORDLESSzg,\
mjvzxafOPTIONSqaktw,\
mjREPxagopREQwjqdzwktw,\
mjREPxagoplruyzwktw,\
mjREPxagopktwzxPOSITIONS,\
mjREPxagoplrPOSzxPOSITIONS,\
mjREPxaGRmlzwktfatv,\
gzektwzwktfatv,\
dCopktwzwxalrPOSbPOS,\
ocSSL_FIPStfc,\
zkucttvh,\
qizwROLLUP,\
vutewd,\
dvuzhog,\
vutepu,\
donmx,\
njvdUSAGE,\
ocqpCONNsm,\
ocCONNsm,\
lhtyaxvvlmzysrw,\
dSFyttimy,\
mgvemazwBACKUPsq,\
ylsxWINDOWS,\
MYSQLBACKUPmuMSG,\
ncnrbxq,\
ojnrbxq,\
gEXECUTEnbzwASSIGNEDktm,\
XAyce,\
rstbwjzq,\
?rsrwADDaxvtbwx,\
tyalfWHILEvamjsbwl,\
donoeDELIMITER,\
donSUPERFLUOUS_DELIMITER,\
mguuSENSITIVEzo,\
dmgSECURELYuuSENSITIVEzo,\
dyplgpl,\
IFaplzbyppltvooe,\
IFaplzbyttjFCTtimy,\
wuuslquwc,\
?REDUCED_DBLWRpunv,\
?REDUCED_DBLWR_PAGEqe,\
xhbsjttORIGIN SR002,\
xhbsuttORIGIN SR002,\
xhzcPROJugPRESENT SR002,\
GIPKmzpl,\
GIPKppltmzpl,\
GIPKmzlhalf,\
ouPKmzykouGIPK,\
nxwqzwGIPKorjSBR,\
?ocEXPIRE_LOGS_DAYSre,\
CTEvqaUNION,\
nbBACKENDppykFETCH_SECURITY_CTX,\
nbwsBACKENDpp,\
mupuvbqavzmq,\
qrvzFORCE_MEMBERSnbpq,\
donIDENT,\
INTERSECT_ALLtbDUPLICATESpe,\
TPvgTHRS_PERqtpfTXN_THRsm,\
lwyjqd,\
SHAPE_PRIDICTIONyt,\
xhbHEIGHT SR002,\
xhbSCALING SR002,\
xhbZONE_WIDTH SR002,\
xhbsjPOLAR_STEREzmA SR002,\
donmufwntz,\
eaoy,\
efvase,\
ejSHAREDya,\
rnOTHERyfPK,\
somdodUNSORTED,\
mdEXECUTORc,\
mdvjslrqpp,\
mdvjslc,\
mdvjwrc,\
mdvjnec,\
mdsoodpp,\
mdspmzyllzqaLEFTOVERmc,\
mdspngc,\
mdsppunrLESS_LINESyfrdmt,\
mdulteENCLOSEDme,\
mdulwjmctbTOTAL_COLSpe,\
mdulCOPYmcwxpe,\
mdulyvENDttINPUT,\
mdulyvwjye,\
mdulyvCHARlcENDING_ENCLOSEDme,\
mdulyvCHARlctqESCAPE,\
mdulyvCHARlcmzye,\
mdulINCOMPLETE_ESCAPE_SEQUENCE,\
somdodpp,\
somdodzzzkqaps,\
somdoddtqykNOTNULL,\
REQUIREevasempGENERATEzwGR,\
gmjSYSzmjvitwtf,\
rsrwADDouaxvtbwx,\
rsrwADDaxvtbpt,\
gwuuv,\
rungwutqzk,\
rungwuzczk,\
donzgohCOLLATIONS,\
zgsqOVERLONGti ,\
dfSPACEzqnc,\
VALIDATEusrxmkCHARACTERS,\
donzwNOTE,\
gRUNnbSERVICES_RECURSIVELY,\
dlpipxvossoq,\
@6000,\
shng,\
shngalu,\
shngzbsh,\
shngmgUNINSTALL,\
xbflhsh,\
?pmsaANALYZEaxv 0A000,\
pmsaIMPLICITqdaxv 0A000,\
pmsaqdaxv 0A000,\
tqglxuvqavk,\
pmsaqanoaxv 0A000,\
rsrizzDROPPED_ENUMsk,\
rsrizztrttINDEXES_ZERO,\
rsrizztrttINDEXESylHIGH,\
rsrioumwtctd,\
rsriENUMtqyete,\
SIMULATEDrrc,\
donDYNAMIC_PRIVjqq,\
mdMULTIvjtxpupp,\
mdMULTIvjvipupp,\
mdMERGEbCHUNK,\
mdMERGEaALL_CHUNKS_CONSUMED,\
mdWRITERslrqpp,\
mdWRITERslc,\
mdSORTINGspzy,\
mdSORTINGspWAIT,\
mdvjtxpupp,\
mdsoeqxrwCOLS,\
mdsowd,\
mdsowopa,\
mdvjc,\
mdvjpuotpk,\
mdvjCOULDNT_RESOLVErb,\
xivxmlbnm,\
mgEXECUTEjva,\
ylsxqrmeMODIFIER_BRANCHES,\
donpaxxfREPLACEMENT,\
QUALIFYzxzvqk,\
xvtwzwrc,\
SPECIFIClaol,\
gwuktmykAUTOMATIC_TAGGEDzuktfsbtu,\
ktmTAGktftu,\
hmwaNULLABLE,\
hdmwteaNULLABLE,\
hmwsboy,\
hmwsboyd,\
hlwzk,\
hofyxpc,\
hofOOMpc,\
hdofROUNDING,\
hofPRECISIONpfwn,\
hpfMIN,\
hpftb,\
hdpfMIN_TRUNCATING,\
hdpftbTRUNCATING,\
hREALsbNAN,\
hucttvh,\
hoeqd,\
hdyr,\
hmgntxq,\
hwdPRINCIPALpc,\
hAWSlqpc,\
hCSVumpc,\
hmztdpc,\
hmztbpc,\
hmozb,\
hujofnspc,\
hxqylst,\
hwdPRINCIPAL_BUCKETpc,\
hfpwqe,\
hoypu,\
howpu,\
hlvwnDEPTHpftb,\
hlvqztd,\
hlvENUMmgntmo,\
hlvENUMtd,\
hlvysmgnt,\
hlvpuENDS_UNEXPECTEDLY,\
hlvpuodnu,\
hlvbUNION,\
hlvbBLOCKwx,\
hlvbBLOCKvnnw,\
hqdqzfMAGIC_BYTES,\
hlvqztcpc,\
hlvqzfwn,\
hlvfCODECjqz,\
hlvbtijwn,\
hlvDECODINGpc,\
hujtnUTF8puENC,\
hujwntd,\
hujwjqrwxpftb,\
hujmgLOCATE_OFFSET,\
hujysmgnt,\
hujmgLOCATEwn,\
hroNUMmwtd,\
hOOM,\
hdrowyLINES,\
hdrowypw,\
hropuqxfod,\
hrofod,\
hrofpw,\
hdrozeogmwNAMES,\
hujmgviqz,\
hrodGOTpg,\
hlvmgukqz,\
hujgtxpu,\
hylsizkpc,\
hylsiwjpc,\
TABLESAMPLE_PERCENTAGE 2202H,\
TABLESAMPLEtwtvBASExz,\
?ugrnucttvh,\
RESULTwxsmpe,\
shngINTERNAL,\
shngCONCURRENCYsm,\
shngRUNTIME,\
shngTIMEZONE,\
shngKEYWORD,\
shngwuxyzn,\
shngzbys,\
shngns,\
dxbxjPARTIALLYpi,\
xmpjalfWITHINxbuaypuayt,\
hsdum,\
pamglxog,\
upPREFIXseaxv,\
dontnSTANDARDse,\
pzfywrnui,\
laolfPROXYqq,\
laolfPROXY,\
hzgodlapp,\
mdvjZSTDc,\
mdulc,\
hbsdpuqdwn,\
hrosdbwn,\
hsdpuqddrown,\
tnSCALARzfASse,\
rjysAGG,\
odrjzwzp,\
pfzptbDIMENSIONS,\
ykzpns,\
?pnzbrnle,\
TPmgopMTLzwDL,\
qtwknoHANDOFF_BUSY,\
@6400,\
wrOFFLINEtfvl,\
?wrOFFLINEtfzg,\
hzafodqe,\
hzapuukpc,\
hzaENCODINGpc,\
hzapuystdpc,\
hzawnpc,\
hmzpaATTRpc,\
hzaOBJvipc,\
hfSEGMENTSqm,\
hzapuylsi,\
petbREGULARxjqvsm,\
pmANALYZEsdqdzqaxv 0A000,\
tnDML_DYNAMICuh,\
DEPRECATEtnCOMPOSABLEtgpa,\
mdsdb,\
mdBLOByllz,\
fvgPLANqe,\
hCPylsxCHANGES,\
hCPaENABLED,\
hCPfzpxo,\
hCPfzjtf,\
?hCPtepwtf,\
hCPndpp,\
hzabsh,\
hzpylsxENTRIES,\
mdulyvENCLOSEDmemn,\
CMD_NEED_SUPERuanxxcvsxy,\
mtre,\
bmtjCONTEXT,\
bmtCOMBINATION,\
dREDACTED_PRIVILEGES,\
bOUTERvs,\
LIBRARIESaxv,\
hdSUMMARY,\
hdrozeogDELIMITERS,\
LIBRARYb,\
mguuymISOLATION,\
hlvbvn,\
hbzkjzp,\
hdzpLOSSYns,\
hzaTRUNCATIONc,\
hzaPAGE_CHUNKd,\
hzaylsxCHUNKS,\
laolFIREWALL 28000,\
hDECOMPRESSIONpc,\
scbojzzlj,\
scALGO_TEMPTABLEaxv,\
sczwmptzaxv,\
scbojtnSIMPLEwqaxv,\
scbojCTEaxv,\
scbojGROUPBYaxv,\
scbojzvqkaxv,\
scbojsmaxv,\
scbojORDERBYaxv,\
scbojMULTIxzaxv,\
scbojfWHEREnljxr,\
scbojWHEREnljROOTOBJECT,\
scbojzzWHEREqdqaxr,\
scbojzzpsys,\
scbojCONTEXT_PREPAREpp,\
scbojfsdtsjROOT,\
scbojMUSTBEsdtsqaSINGLETON,\
scbojMUSTBEsdtsqatk,\
scbojfsdOBJjARRAYAGG,\
scbojRELATIONSHIP_RULES_VIOLATED,\
scbojmzysaxv,\
scbojtnBASEeaxv,\
scbojezxPKqe,\
scbojezxPK_PROJECTIONqe,\
scbojIDsezfmeaROOTe,\
scbojIDseazfmeROOTe,\
scbeljqaSINGLETON_OBJ,\
scbeljqatkOBJ,\
scbojowsgaxv,\
scbojowmzaxv,\
scbojwmerkPROJECTION,\
scbojmzsnaxv,\
scbojrkepsjTHEts,\
scbojWHERE_USEStnIMMEDIATEui,\
scbojCOMPOSITEsezf,\
scbojALIASazfqawmxz,\
sctyaxv 0A000,\
sclhuavwaxv,\
scbsdDUALITYtsUSAGE,\
scyvsdys,\
scvasethlxPROVIDED,\
scJOINnlaSATISFIED,\
scPK_DUPLICATESaIDENTICAL,\
scUNMAPPEDse,\
sctertTAG,\
sctevkxr,\
scJOINnlVIOLATION,\
scteETAG,\
scETAGtd,\
sctezk,\
scPK_UPDATESalf,\
sctezdTAG,\
scteokTAG,\
sctqrtzk,\
scrtzkaFIXED,\
sctqzdzk,\
sczdzkaFIXED,\
?scprEDITIONsm,\
scmglxzfzw,\
scDMLrp,\
?sctezkqaAGmz,\
scbBINARYysqz,\
ETAGaxv,\
palonn,\
pnqdaxv,\
pnebtz,\
pnepaaxv,\
pnepaaxe,\
hfpwqefwppuPRIV,\
hmwtite,\
hmwtiow,\
hzaOCI_GENAIpq,\
hzauopuukpc,\
scEXPLICITlrrmalf,\
hromwtitd,\
hDELTAwntd,\
hDELTAtcvic,\
hDELTAzbc,\
dACCOUNT_TRIMMED,\
hdoetgufze,\
hGENCOLc,\
TEMPORALqkud 22008,\
hromztbpc,\
hEXTRAnajpu,\
hujCOMPLEXns,\
lpioq,\
lpingsdpxumc,\
lpippyktxxz,\
lpippyktxe,\
lpingsdpxtimglxoy,\
lpingzgtibmn,\
lpifsfrv,\
lpingmgvius,\
lpingrbtibmn,\
lpingsdzgtimglxoy,\
lpingsfIDyjzksbb,\
lpingytblnys,\
lpingytblnnw,\
lpiABORT,\
lpiCOULDaRELOADpy,\
lpiytblntq,\
lpitbwxCLOSEykwgtvwx,\
lpitbwxliPRUNE_SECONDS_PRECEDENCE,\
lpiusqxaBEENwu,\
lpibeoj,\
lpingpxppykxoeFLDS,\
lpingpxppykrqeqavi,\
lpingpxppykokFROMe,\
lpisdpxosapkzg,\
hCUSTOModPLACEMENT_OVERRIDES,\
hlvpwodystd,\
lpingbpxABORT,\
lpingsdbpxmglxzf,\
dlpipyb,\
scqmliEXPLICIT_PKSalf,\
syuxngc,\
syuxlgpl ,\
syuxEXPECTS_CASE ,\
syuxEXPECTS_CASEzu ,\
syuxteELSE ,\
syuxONEzuwb ,\
syuxthRETURNln ,\
syuxbGATEKEEPER ,\
syuxtnLITERAL_GATEKEEPER_ARG ,\
syuxorCONSTRUCT ,\
syuxbmzvs ,\
syuxrjmzpr ,\
syuxrjTYPES ,\
syuxtnDETERMINISTICqj ,\
pztbxzjCASCADE_CHAINpe,\
pzCASCADEyqUPDATINGpznaaxv,\
gzdzfejpzCASCADE,\
dwuOPERATIONSmc,\
scyvbzk,\
@6900,\
nzyxllzq,\
nzllWORKERnwucttvh,\
nzllWORKERnwtwqaCSA,\
CSAzbUNTILnk,\
nzllpdMEMORYsmtwqaCSA,\
dnzllpdMEMORYsmucttvh,\
CSAnzDELAYEDllaxv,\
CSAnzREQUIREMENTwjqd,\
CSAnzREQUIREMENTktw,\
ocmgvyzxma,\
vxIDENTITYnn,\
mdvjutsbDIRECTORY,\
scmzTAGaxvqaxt,\
sczdmzTAGaxvqaPK`
