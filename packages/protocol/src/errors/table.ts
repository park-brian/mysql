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
export const ERROR_NAME_WORDS = 'NOT INVALID ERROR WARN TABLE NO CANT LH LOG IN GTID WRONG SUPPORTED PARTITION BINLOG CANNOT DEPRECATED COLUMN DEFINITION FAILED COMPONENT REPLICA UNSUPPORTED VALUE TABLESPACE UNKNOWN AUDIT ENCRYPTION INNODB ALLOWED MISSING PASSWORD OPERATION INDEX CHANGE CREATE JSON REPLICATION ENGINE TRANSACTION FUNCTION GENERATED NAME UNSAFE KEY WITH EXISTS SOURCE TOO RANGE USER MISMATCH WINDOW DEFAULT CONSTRAINT UNSTRUCTURED GROUP FILE FUNCTIONAL JDV MODE FORMAT PLUGIN BULK TYPE FOR OPTION SCHEMA SELECT ALTER EVENT COMPONENTS FIELD ACCESS CLIENT REGEXP UPDATE FAILURE VARIABLE ANONYMOUS INCOMPATIBLE DATA SYSTEM GEOMETRY LANGUAGE FOUND CHARACTER CHANNEL SET UNEXPECTED MULTIPLE READ FOREIGN KEYRING STATEMENT ARGUMENT EXCEEDED DROP ONLY DENIED DUPLICATE EXCEPTION SIZE VIEW CHECK EMPTY MASKING WITHOUT DISABLED PREVENTS REQUIRES LONG PRIVILEGE ARCHIVE ILLEGAL SERVICE INCONSISTENT LIMIT FILTER MASTER POLICY REASON SRS AUTO VERSION ATTRIBUTE CONVERSION REFERENCED TO MAX ROW PARSER TABLES THREAD COMPRESSION CONSISTENCY IMPLEMENTED CLONE LOCK NULL OPEN APPLIER CHARSET RUNNING TIMEOUT LENGTH UDF GRANT AGGREGATE RECURSIVE TIMESTAMP RESOURCE ROTATION RPL OUT EXIST READER SERVER STRING SWITCH UNUSED ALREADY COMMENT EXCEEDS IGNORED PARQUET MUST USED ORDER QUERY RECOVERY ALGORITHM MANDATORY REGISTRATION AVRO MANY COMMAND CORRUPT DISABLE EXPLAIN CONNECTION SP NON COUNT INFER WRITE DOES LOAD ON ERR CLAUSE HEADER OBJECT SYNTAX OF POSITION BAD FUNC WHEN AFTER SLAVE COLUMNS HANDLER LOGGING PRIMARY COLLATION CONDITION DIFFERENT INCREMENT PARAMETER REFERENCE TRUNCATED AND USE LIST REDO STMT FIELDS SUBPARTITION NEXT TEMP AUTOINC FEATURE PARTIAL SPATIAL CONFLICT CREATION EXECUTED METADATA OVERFLOW ROLLBACK IS DUP CURSOR DELETE DOESNT DURING INSERT UNABLE VALUES CORRUPTED DEPENDENT INCORRECT MALFORMED RECURSION SECONDARY TEMPORARY TRANSFORM VARIABLES BIG TRG COL PATH MATCH PURGE CONVERT FILTERS SESSION DISALLOWED PARAMETERS REPOSITORY STATISTICS VALIDATION COMMUNICATION CONFIGURATION NATIVE NUMBER PURGED VECTOR EXTERNAL REQUIRED VAR FAIL HAVE INFO PART SAME STOP SUCH INSUFFICIENT SQL FILES FRAME PARSE START AVAILABLE COLLISION FILEGROUP HEARTBEAT PERSISTED PROCEDURE RECONNECT REPLICATE SPECIFIED FK GRP ROLE CHECKS COMMIT IMPORT PARENT SIGNAL UNLOAD DECIMAL FPARSER INSTALL INSTANT TRIGGER VIRTUAL ANNOTATIONS INTERRUPTED NONEXISTING DA OFF BOOST GTIDS PARAM STORE COMPLETE DATETIME EXCHANGE FULLTEXT GROUPING INTERVAL LATITUDE READONLY SETTABLE SUBQUERY AUTOEXTEND CONCURRENT HYPERGRAPH PARTITIONS TERMINATOR IMPLEMENTATION NONPARTITIONED BE ACTIVE BEFORE BUFFER GLOBAL HANDLE IGNORE LOADER LOCKED NESTED PACKET RECORD ROTATE SECURE STORED TARGET UNIQUE NET STD AUTH CRST HOST INIT UUID CACHE CHILD ENTRY LARGE USING CHANGED CURRENT DEFINED DEFINER GEOJSON LIBCURL PARSING PERSIST REPLACE ROUTINE SKIPPED WARNING'

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
gmxnt,\
gmxe,\
gmxDB,\
DBmxni,\
DBphni,\
?DBphuo,\
DBphRMDIR,\
?guont,\
gFINDosREC,\
gGET_STAT,\
?gGET_WD,\
gqw,\
gqynt,\
ntaov,\
gpbDIR,\
?goyWD,\
CHECKREAD,\
?DISK_FULL,\
umng 23000,\
?csuCLOSE,\
csupb,\
csuRENAME,\
csusr,\
ntrz,\
?FILSORT_ABORT,\
?FORMaov,\
GET_ERRNO,\
pyHA,\
ngaov,\
aFORMnt,\
aKEYFILE,\
OLD_KEYFILE,\
qyASyb,\
OUTOFMEMORY HY001,\
rmtaSORTMEMORY HY001,\
?ozEOF,\
CONspc 08004,\
rmtaRESOURCES,\
tczgc 08S01,\
HANDSHAKEc 08S01,\
DBACCESSpjc ,\
ojpjc 28000,\
fDBc 3D000,\
mnCOMc 08S01,\
tcqxc 23000,\
tcDBc ,\
enic 42S01,\
tcec 42S02,\
soUNIQc 23000,\
rpSHUTDOWN 08S01,\
tcoic 42S22,\
loinhns ,\
lnsoi ,\
lSUMoe ,\
lmlsp 21S01,\
nkpvIDENT ,\
umFIELDNAME 42S21,\
umKEYNAME ,\
umzl 23000,\
loiSPEC ,\
wlc ,\
ppsb ,\
NONUNIQe ,\
bnp ,\
paPRIng ,\
nkshKEYS ,\
nkshngPARTS ,\
nkpvng ,\
ngmfssaEXITS ,\
BLOBrzASng ,\
nkvdFIELDLENGTH ,\
lqhng ,\
READY,\
?NORMAL_SHUTDOWN,\
?GOTxd,\
SHUTDOWNxu,\
FORCING_CLOSE 08S01,\
IPSOCKc 08S01,\
fwgmv 42S12,\
loiTERMINATORS ,\
BLOBStsfTERMINATED ,\
TEXTFILEaREADABLE,\
ntnic,\
stwc,\
ofwc,\
lSUBng,\
gREMOVE_ALLtx ,\
gphoiORng ,\
urwc,\
omerz,\
fwgqr,\
KILLpjc,\
fqqrz,\
nkvdoy,\
fzbLOGFILE,\
eaytobsr,\
eayt,\
BLOBgwbnp ,\
lDBne ,\
lene ,\
nkvdoe ,\
mnc,\
mnws ,\
lPARAMCOUNTqmws ,\
lvnqmws,\
mne 42S02,\
oiwvTWICE ,\
bnstdtt,\
mkEXTENSION ,\
erywbth ,\
ywntFULL,\
mnowoy ,\
nkshqq,\
nkshtx,\
nkvdROWSIZE ,\
STACK_OVERRUN,\
lOUTER_JOINrs ,\
qxmfjmv ,\
gFINDre,\
gINITIALIZEre,\
refPATHS,\
reni,\
gqyLIBRARY,\
gFIND_DLzl,\
ncazq,\
zgulBLOCKED,\
zgaPRIVILEGED,\
mtopnm ,\
mtamr ,\
mtfvh ,\
omwc,\
gmxqr,\
lmlspsuqo 21S01,\
gREOPENe,\
btttaqx 22004,\
olc ,\
MIXtanstdtstx ,\
xnrf ,\
TABLEACCESSpjc ,\
COLUMNACCESSpjc ,\
pyrfobe ,\
rflzgORnm ,\
fwge 42S02,\
xnerf ,\
amrsi ,\
szc ,\
?UNUSED1,\
?UNUSED2,\
ABORTINGsm 08S01,\
zcyvnkzm 08S01,\
zcpbcFROM_PIPE 08S01,\
zcFCNTLc 08S01,\
zcPACKETSrmtasa 08S01,\
zcUNCOMPRESSc 08S01,\
zcpbc 08S01,\
zcpbxm 08S01,\
zccsusr 08S01,\
zcsrxm 08S01,\
nkpvrq ,\
egyqBLOB ,\
egyqqhto ,\
?UNUSED3,\
lmfne ,\
lngmf ,\
lMRGe,\
umzb 23000,\
BLOBngprrd ,\
tkgwbqx ,\
nkshROWS ,\
putkng ,\
?fRAID_COMPILED,\
omprngjSAFEnw,\
ngssaEXITS ,\
pofwge ,\
poaqu ,\
gDO_THISuqANnb 25000,\
cuqxa,\
cuquk,\
cuqFLUSH_LOGS,\
?cuqCHECKPOINT,\
NEW_ABORTINGsm 08S01,\
?DUMPaqu,\
?FLUSHqdmcCLOSED,\
?mvREBUILD,\
nj,\
njzcpb 08S01,\
njzcsr 08S01,\
FT_MATCHINGngaov,\
qwORymnb,\
mnosoo,\
CRASHEDsuUSAGE,\
CRASHEDsuREPAIR,\
zzaxuuk,\
TRANSzjFULL,\
?tgrywf,\
mjarb,\
tcmj,\
smui,\
mjqr,\
nkshnmCONNECTIONS ,\
oyCONSTANTSpi,\
qwWAITrc,\
qweFULL,\
pbpinb 25000,\
?phDBnhpbqw,\
?mxDBnhpbqw,\
lARGUMENTS,\
fPERMISSIONqmmxnm ,\
?UNIONqqjtnDIR,\
qwDEADLOCK 40001,\
egyqFT,\
mdADDpc,\
fqlqo 23000,\
qoulql 23000,\
CONNECTqmnj 08S01,\
?sbsuqd,\
cteEXECUTINGsi,\
lUSAGE,\
lvutathjoe 21000,\
gomnhREADLOCK,\
MIXINGamr,\
umpf,\
nmqbREACHED ,\
SPECIFICojpjc ,\
LOCALoo,\
ypoo,\
fnp ,\
lmlobvz ,\
loaobvz ,\
vzgylpb,\
gttocHERE ,\
amaYET ,\
njFATALcREADINGmc,\
mjrwe,\
uwypLOCALvz,\
lwwDEF ,\
ngREF_DOavheREF,\
OPERANDth 21000,\
ydf1qo 21000,\
mntwti,\
sjHELP_DB,\
?CYCLICtq,\
qhvj,\
pytq 42S22,\
DERIVEDrywbALIAS ,\
oeREDUCED 01000,\
TABLENAMEamrHERE ,\
amazenw 08004,\
uegwbqx ,\
tlrann ,\
?tgWASrb,\
?tgWASarb,\
nkvdobUNCOMPRESS,\
ZLIB_Z_MEMc,\
ZLIB_Z_BUFc,\
ZLIB_Zorc,\
CUTmlnsCONCAT,\
dnkFEW_RECORDS 01000,\
dnkshRECORDS 01000,\
dqxqmNOTNULL 22004,\
dorrmtanl 22003,\
!dortr 01000,\
dznOTHERti,\
grg2COLLATIONS,\
?phnm,\
REVOKE_GRANTS,\
grg3COLLATIONS,\
grgNCOLLATIONS,\
ooulaSTRUCT,\
mntl,\
mjrwSSL_PARAMS,\
?rpuljyyzenw,\
doiRESOLVED,\
tcmjUNTIL_COND,\
msSKIPmj,\
UNTIL_CONDrw,\
lneobmv ,\
lneobCATALOG ,\
?dQC_RESIZE,\
tcFTmf,\
mnngzj,\
dHOSTNAME_WONT_WORK,\
mnSTORAGEna ,\
dmesz,\
soUPDATABLEe,\
ucps,\
ocptpe,\
DUPLICATEDmljoa,\
trlml 22007,\
?nkMUCHqhriCOLS,\
bsuom,\
mkPS,\
GET_ERRMSG,\
GETvaERRMSG,\
mnTIME_ZONE,\
dbri,\
bowrq,\
dmryvOVERFLOWED,\
CONFLICTING_DECLARATIONS,\
snfrhmx 2F003,\
snrtni ,\
snssarn ,\
snphmh,\
snxtmh,\
snLILABELnn ,\
snLABEL_REDEFINE ,\
snLABELnn ,\
snUNINITvz 01000,\
snBADSELECT 0A000,\
snBADRETURN ,\
snBADSTATEMENT 0A000,\
omimerw ,\
omimeTRANSLATED ,\
sbxm 70100,\
snlftaARGS ,\
snCONDnn ,\
snNORETURN ,\
snNORETURNEND 2F005,\
sntcunsb ,\
sntcunoe ,\
snunnn ,\
snunrtqy 24000,\
snunaqy 24000,\
snUNDECLAREDvz ,\
snlftaFETCH_ARGS,\
snFETCHfor 02000,\
snumxs ,\
snumvz ,\
snumCOND ,\
snumCURS ,\
sngof,\
snSUBSELECT_NYI 0A000,\
twamrjSF_ORve 0A000,\
snVARCONDtfCURSHNDLR ,\
snuntfti ,\
snCASEaov 20000,\
xgnkvdnt,\
xgtcsx,\
xgEOFjru,\
xgcjtp,\
xgEOFjmntp,\
pnfsl,\
?FRMmnoa,\
lsy,\
NONUPDATEABLEmf,\
?pnoeDERIVEDrs,\
pnoesw,\
pnoeoo,\
pnoeTMPTABLE,\
pnltu,\
dpnMERGE,\
dpnprng,\
pnb,\
snfphsn,\
?snGOTOjHNDLR,\
vertni,\
vessarn,\
vesupnORuae,\
vegmwqo,\
vefwgqojve,\
fnpoboi,\
DIVISION_BY_ZERO 22012,\
trlmloboi,\
pymloboa 22007,\
pnNONUPDpo,\
pnpomh,\
PROCACCESSpjc ,\
RELAYiwa,\
?PASSWDrd,\
mnzamc,\
IOsvimvpb,\
mcviPROHIBITED,\
FSEEKwa,\
mcviFATALsv,\
ijtt,\
ivimnsv,\
RELAYizh,\
fBINARYtj,\
RESERVEDsz,\
?WSASmh,\
?DIFF_GROUPS_PROC,\
?fnsobPROC,\
?sanhPROC,\
?tjPROHIBIT_CHANGINGta,\
?fntMAPPING,\
?lMAGIC,\
PSshxs,\
ngwd0,\
pnCHECKSUM,\
pnMULTIUPDATE,\
pnfuroitu,\
pnuoMERGEpn,\
mdnm,\
XAER_NOTA XAE04,\
XAER_INVAL XAE05,\
XAER_RMFAIL XAE07,\
XAER_OUTSIDE XAE09,\
XAER_RMERR XAE03,\
XA_RBROLLBACK XA100,\
xnPROCrf ,\
PROCqhrfwa,\
PROCqhREVOKEwa,\
ornkpv 22001,\
sntcSQLSTATE ,\
STARTUP,\
stFROM_FIXEDpmROWSqmvz,\
gmxnmnhrf ,\
lmloboa,\
eDEFzo,\
snumti ,\
snavzARG ,\
snfRETSET 0A000,\
gmxotsy 22003,\
?mhzxBREAKmc,\
mcnfzx,\
mcmxzxNEED_SUPER,\
?EXECtwnhqyun,\
twHASfqyun,\
xaamrjSF_ORve,\
fnpobpnoi,\
snfuy,\
nkvdSCALE ,\
nkvdPRECISION ,\
M_BIGGER_THAN_D ,\
lqwtaose,\
CONNECTqmpcornj,\
sbsupcornj,\
pcornjuprn,\
pcorrqbgmx,\
pcorrqb,\
?gmxFEDERATEDe,\
vejlod,\
STACK_OVERRUN_NEED_MORE,\
nkpvBODY ,\
dgphnpKEYCACHE,\
nkvdDISPLAYWIDTH ,\
XAER_DUPID XAE08,\
xvncuj 22008,\
gomrzejSF_ORve,\
pnPREVENTom,\
PSfuy,\
sngoyAUTOCOMMIT,\
?uxzr,\
pnFRMfnm,\
pnOTHERnm,\
fwgnm,\
FORBIDodmw,\
qoulql2 23000,\
fqlqo2 23000,\
sntcvzSHADOW ,\
vefzr,\
OLDntnx,\
snuyqb,\
?snPROCesj,\
snlne ,\
eNEEDS_UPGRADE,\
snfrg ,\
qnPREPAREDtwspREACHED ,\
pnrh,\
soxyoirz ,\
egyqSPKEYS,\
fTRIGGERSsuosod,\
REMOVED_SPACES,\
ubpbmh,\
USERNAME,\
HOSTNAME,\
lrqrd,\
soINSERTABLEe,\
ADMINlMRGe,\
nkHIGH_LEVELtaNESTINGoboe,\
neBECOMESpp,\
AMBIGUOUSoiTERM,\
pcrpni,\
pcrpuprn,\
pyHAmxoc,\
mbpuutc,\
mblutc,\
mbMAXVALUEc,\
?mbtyc,\
?mbSUBPART_MIXc,\
mblfwdc,\
mblfSUBPARTc,\
lEXPRjmbtdc,\
?fCONST_EXPRjnlORtuc,\
oiaovwdc,\
?tutatxpijHASHc,\
qambwcc,\
mbtdamrc,\
yhryylzqc,\
nlaINCREASINGc,\
qaoataFUNCTIONSc,\
paDEF_CONSTjtuwdc,\
mbzlc,\
MIXtic,\
mbazqc,\
nkshyhc,\
tyc,\
gmxtint,\
BLOBoijwdtdc,\
zbngNEED_ALLtxjPF,\
fPARTSc,\
mbMGMTsuyk,\
pcngsuPARTITIONED,\
phmbsoEXISTENT,\
phLASTmb,\
COALESCEpisuHASHmb,\
REORG_HASHpisuwef,\
REORGfxsc,\
pisunltumb,\
ADDmbSUBPARTc,\
ADDmbfNEWmb,\
COALESCEmbfmb,\
REORGmbarn,\
wenemb,\
fmcc,\
CONSECUTIVE_REORGyh,\
REORG_OUTSIDEnl,\
mbncon,\
?wdSTATEc,\
LIMITEDwdnl,\
nyulaLOADED,\
lml,\
fmbobGIVENml,\
wpocpiONCE,\
mxwpmh,\
phwpmh,\
mmqhEXTENDc,\
lpmvu,\
pmujc,\
ofwpmh,\
mcqotjmh,\
?mcqoleDEF,\
?mcqoRBRqmSBR,\
ogrtni,\
?ogxtmh,\
ogssarn,\
?oggof,\
?ogphmh,\
ogxzaPOSITIVE_ORnkvd,\
ogENDSynSTARTS,\
ogEXEC_TIMEjTHE_PAST,\
?ogqyemh,\
?ogNEITHER_M_EXPR_NOR_M_AT,\
?vfspupvhuu,\
?mdstFROMe,\
?ogmduo,\
?ogCOMPILEc,\
ogwene,\
?ogornkpv,\
phmvww,\
dmesznhVER,\
?gsrqwie,\
gqwie,\
pcpkngOLDrs 23000,\
vfspupvhPLEASEom,\
?uaeptrrrmtaRBR,\
yzncptrrmcnx,\
?NDBgrrmcnx,\
mbfva,\
mbCONST_DOMAINc,\
mbnculamr,\
?DDLicrs,\
qxjutLESS_THAN,\
lmbne,\
gmwTX_CHARACTERISTICS 25001,\
umzlAUTOINCREMENT_CASE,\
?ogMODIFY_QUEUEc,\
ogoyvzc,\
mbMERGEc,\
?gACTIVATEi,\
?RBRawn,\
BASE64_DECODEc,\
oguyFORBIDDEN,\
?EVENTS_DBc,\
piINTEGERSmr,\
UNSUPORTEDina,\
tcipe,\
gRENAMEie,\
lPARAMCOUNTqmvtFCT ,\
lvnqmvtFCT ,\
lvnqmyzFCT ,\
vtFCTnewo,\
umzlnhngne 23000,\
mcviEMFILE,\
ogmdmxjTHE_PAST,\
ogmdofjTHE_PAST,\
?tgINCIDENT,\
fmbobGIVENmlSILENT,\
mcnfpe,\
mcFATALc,\
?tgRELAYipbon,\
?tgRELAYisron,\
?tgmxogon,\
?tgqdCOMon,\
mctjIMPOSSIBLE,\
pnfugCTX,\
pnbugCTX,\
?SRbugCTX,\
veuunt,\
vefugCTX,\
vebugCTX,\
ogbugCTX,\
vegqye,\
?gmxSROUTINE,\
?NEVERrz,\
fnxDESCRIPTIONogynmcpe,\
mjsjog,\
?storbmfrs,\
ivifnt,\
XA_RBTIMEOUT XA106,\
XA_RBDEADLOCK XA102,\
NEED_REPREPARE,\
?DELAYEDama,\
!dfsmui,\
!docrw,\
nyuoBUILTIN,\
!dnyBUSY,\
ooulyb,\
dnanbuk,\
?tgwqon,\
mjwqmlrmtanl,\
NDBmzodc,\
ufFNwlc,\
EXCEPTIONSsrc,\
nkpveru,\
nkpvoiru,\
tdINEXISTENTnewo ,\
DATABASEne,\
ene,\
mbne,\
tyne,\
vane,\
RENAMEDne,\
nkshyfTRXS,\
!dsoASCII_SEPARATORaqu,\
DEBUG_SYNCrc,\
DEBUG_SYNC_HITqb,\
umxdoy ,\
xdd 01000,\
xdaov 02000,\
xdpl,\
RESIGNALprymti 0K000,\
xdtctmoa,\
!dCOND_ITEMtr,\
COND_ITEMnkpv,\
mnLOCALE,\
mjyrrpIDS,\
?sbzjps,\
wenemboi,\
mbmftuc,\
loamfmlc,\
nkshmbtdtxc,\
MAXVALUEjutj,\
nkshutc,\
qoSINGLEmboic,\
oioaamrASmboi,\
mbtxnkpv,\
mcqonatstwna,\
mcqonwtstwna,\
mcnftstwna,\
mcqoINJECTIONtstwna,\
mctwnwtsqona,\
mcqoINJECTIONtstwnw,\
mcpaENGINEStsSELFtjna,\
mcnfqb,\
?UNUSED4,\
mcnfose,\
mcnfubth,\
mcnfre,\
mcnfosoo,\
mcnfosnc,\
mcnfNONTRANStfTRANS,\
MESSAGEtspe,\
?tgqkmh,\
mjgmxqk,\
INSIDEnbptrrmcnx,\
vgrd,\
dmeszfREPLACEMENT,\
lvteSTRUCTURE,\
lPERFSCHEMA_USAGE,\
dI_Szye,\
INSIDEnbptrrmcDIRECT,\
yzncptrrmcDIRECT,\
uerywbGEOMvf ,\
nkpvmvru,\
qwABORTED,\
orrmtanl 22003,\
?lSPVARoajqb,\
mcnfpaENGINEStsSELFtjna,\
mcnfMIXEDpe,\
INSIDEnbptrrwiiBIN,\
yzncptrrwiiBIN,\
mhpbFROM_PARnt,\
utulaINToac,\
ojpjfmtc 28000,\
?oymtzeny,\
?rfnynmni,\
TRUNCATEpyww ,\
nyulPERMANENT,\
mjwqmlrmtanlMIN,\
mjwqmlrmtanlqn,\
twzjFULL,\
MULTIomnguf,\
eNEEDS_REBUILD,\
!docBELOWqb,\
mvmfnkpv,\
cjxjBODY,\
cjmnxjBODY,\
mvsj,\
UNDOywnkvd,\
mcnfuryroe,\
mcnfuroeom,\
mcnfzwoe,\
mcnfmxyroe,\
mcnfmxzwoe,\
mcnfomyr,\
nyfUNINSTALL,\
nyfxh,\
mcnfsruboe,\
mcnfmxoeub,\
mcnfurTWO_KEYS,\
ejwwpo,\
mkna,\
mcnfubaFIRST,\
mdstFROMeV2,\
njDELAYmlrmtanl,\
piFDtsRBR_EVENTSmrjmcpe,\
mbxwtnoc,\
mbxwwde,\
mbxwuae,\
mbINSTEADtaty,\
mnmb,\
qqtnui,\
qossavhmb,\
mczjpmGREATER_THANqn,\
dmvaAPPLICABLE,\
mbxwpcng,\
?fwgngml,\
rlwcornkpv,\
?NETWORKpbogCHECKSUMon,\
?mcpbogCHECKSUMon,\
mctwzjpmGREATER_THANqn,\
gomejmxeoe,\
mbswsuyk,\
qossavhGIVENmboy,\
?fwgmb~rs,\
mwrlwcvoon,\
zzaxuuknhCREATEDuae,\
zzaxuuknhDROPPEDuae,\
MTAuculama,\
MTA_UPDATED_DBS_GREATERqn,\
MTAgPARALLEL,\
MTAqaor,\
xxamanhPARTITIONING,\
xobtmvu 35000,\
INSECURE_PLAIN_TEXT,\
INSECUREmwnj,\
pcpkngnhzkwc 23000,\
pcpkngprzkwc 23000,\
SQLTHREADnhyymj,\
eHASfFT,\
ooaycjSF_ORxj,\
ooaycjnb,\
?ktzulajktztu,\
?gmwktzjnb,\
oypemdINVOKEnc,\
ktzgylAUTOMATIC_IFktztuulsoqx,\
?SKIPPING_LOGGEDnb,\
uxkoySPECIFICATION,\
uxkoyENCODING,\
uxkSPECIFICATION,\
GNO_EXHAUSTED,\
tcmjqhtb,\
qhtbpuknwaxp,\
gDO_IMPLICITxajTRXtektzuloy,\
knwsupuENFORCEkqtsu,\
?knwpumc,\
goyktzqmkteknwulxp,\
goyktzqmopteknwulsu,\
goyktztuqmsoqxteknwulxp,\
?ovkogteknwulxp~rs,\
knfsoTRANSACTIONALe,\
knfmxoe,\
?knfmxphuaejnb,\
knwCANpimwONE_STEP_AT_A_TIME,\
njHASvvvyxr,\
goyktzteOWNINGk,\
mnslnx,\
gEXECUTEjpbpinb 25006,\
nkpvembru,\
mjvs,\
mqFTqb,\
mqfFTuae,\
mqFTlDOCIDmf,\
mqFTlDOCIDmv,\
mqONLINEinkvd,\
mnofsd,\
mnofqw,\
MTAmwnjgRUNnhGAPS,\
MTAscon,\
MTA_RESET_WORKERS,\
vfspupvhuuV2,\
mjSILENT_RETRYnb,\
DISCARDwwwzrb,\
eodnn,\
ejosmm,\
IOpbc,\
IOsrc,\
mmms,\
mmni,\
mmDISCARDED,\
INTERNALc,\
mqxbc,\
mqmvsj,\
bYEARmfrd,\
aVALIDmt,\
rymwmt,\
wwfmvzk,\
wwfmvxc,\
wwwaADDos,\
wwmdqyxc,\
wwuwoc,\
wwumne,\
mtnx,\
wwmfmdph,\
wwmfmdphzk,\
wwmfaqx,\
ummv,\
wwmfmdmw,\
wwmfmdmwzk,\
?UNUSED5,\
uxyv,\
pbpinw,\
ktzoaUNDEFINEDk,\
ooaycjsn,\
?goykvvteknwulxp,\
goykvvtekuhulapp,\
goykvvteOWNEDxrulapp,\
kvvWASzo,\
kuhWASzo,\
mctwnwtsfREPLqq,\
ofmuama 0A000,\
ofmuamaqf 0A000,\
ofmuamaqfCOPY,\
ofmuamaqfmb,\
ofmuamaqfwwRENAME,\
ofmuamaqfmfoa,\
ofmuamaqfwwpo,\
?UNUSED6,\
ofmuamaqfNOPK,\
ofmuamaqfub,\
ofmuamaqfHIDDEN_FTS,\
ofmuamaqfmwFTS,\
ofmuamaqfFTS,\
?wimjSKIP_COUNTERaycjknw,\
ummnjmv 23000,\
IDENT_CAUSESnkpvvg,\
ofmuamaqfaqx,\
rymwmtLOGIN,\
qojlmb,\
MTAogBIGGER_PENDING_JOBSpmqn,\
?mqfFT_USESqp,\
mcLOGICAL_CORRUPTION,\
dviijtt,\
dviiulym,\
qhtouf,\
!dsuBLOCKHOLEjRBR,\
mjCMzhvo,\
mjAMzhvo,\
ojpjmwnmc 28000,\
mqpbpi,\
wfmjwiqrrc,\
wfmjIOqrrc,\
esj,\
uantsron,\
mqFT_AUXaHEX_ID,\
OLD_TEMPORALS_UPGRADED,\
mqFORCEDsc,\
AESbIV,\
nymdylUNINSTALLED,\
knfmcSPLITTABLEpetsASSIGNEDk,\
mjHAS_MORExrTHANnj,\
msng,\
!dNAMED_PIPEojEVERYONE,\
@3000,\
ntsj,\
csunj,\
?qac,\
STORAGEnaaLOADED,\
GET_STACKEDxoprymti 0Z002,\
dLEGACYszCONVERTED,\
mcnfxxny,\
mdDISCARDvae,\
wwDEPTHpg,\
vfspupvhPLEASEomV2,\
dxjupwbCREATED,\
qlvessarn,\
slama,\
boipm,\
msHAmxoc,\
narmtaMEMORY,\
mtEXPIREopnm,\
mjwiqrrywf,\
fFT_MATERIALIZEDyd,\
mqUNDOiFULL,\
bpfobLOGARITHM 2201E,\
mjoxIOqrrywf,\
dqyuaqqryylZERO,\
dpinjintfPOS,\
sbrc,\
soROoeskTIMER,\
umtuzl,\
?winwfEFFECT,\
rgsaobUNION,\
rgsasoAGGsb,\
mjWORKER_STOPPED_PREVIOUS_THDc,\
?DONT_SUPPORTmjPRESERVExasa,\
rpOFFLINEnw,\
GIStnSRIDS,\
GISmkpf,\
GISmnc,\
GISmnpl,\
GISbor 22023,\
xqotppINPUTpl,\
xqotCENTROIDpl,\
xqotOVERLAYbINPUTpl,\
xqotTURNwcpl,\
xqotSELF_INTERSECTION_POINTpl,\
xqotmnpl,\
zdtcALLOCc,\
zdDOMAINc,\
zdrdc,\
zdbpf,\
zdrmtanlc,\
zdujc,\
zdnlc,\
zdUNDERFLOWc,\
zdLOGICc,\
zdRUNTIMEc,\
zdmnpl,\
GISorlENDIANESS,\
mwnjmtrd,\
nmqwlne ,\
nmqwDEADLOCK,\
zwINACCESSIBLE_ROWS,\
ofmuamaqfGIS,\
pynmvz ,\
knwxp,\
?mkBYmzqr,\
uwoa,\
oijsaaoe,\
rgjsaaoe,\
brlWILDeqcPATTERN,\
zcOKyvnkzm 08S01,\
bmyor,\
bzsmsMEMBER,\
bzsloa,\
bzsUNSPECIFIED,\
DIMENSIONmk,\
mjoxssarn,\
?tgpaCHANNELSzgPORT,\
mjoxnebORnkpv,\
mjNEWoxlvo,\
?tgoxuo,\
mjpaCHANNELS_CMD,\
mjqnCHANNELSpg,\
mjoxrywf,\
mjoxarb,\
mjoxWASrb,\
mjoxWASarb,\
mjoxwiqrrywf,\
mjoxwiSKIP_COUNTER,\
loinhnsV2,\
MIXtanstdtstxV2,\
dmeSYSVARom,\
dmeSQLMODE,\
mdiudphDATABASEnhk,\
nsmzvs,\
nsmzrb,\
nsmzqzzhc,\
nsmzwfqzqrrc,\
nsmzvrLAYERvlc,\
nsmzvrLAYER_JOINc,\
ynDMLvqc,\
ptooprRBR,\
RUN_HOOKc,\
nbukuqxa 40000,\
ndmfnculamr,\
mkofINPLACEsuxkmf,\
lwwocobndmf,\
sonpmlobndmf,\
mkACTIONsundmf,\
ndmfsoPRIOR,\
uvBYndmf,\
ndmfREFqhINC,\
ucawn,\
goyknw,\
gttqhtbnhknwxp,\
?gwuopnhqhtb,\
?gwuopnhknwsu,\
?gwuknhknwxp,\
gENFORCEkqtnhONGOINGkVIOLATING_TX,\
ENFORCEkqtdnhONGOINGkVIOLATING_TX,\
ACCOUNT_HAS_BEENyt,\
lmmne ,\
mmulapp,\
lntne,\
xqotqaTURNSpl,\
dOPTIMIZER_HINTszc,\
dtcqnEXECUTION_TIME,\
dmkqnEXECUTION_TIME,\
dCONFLICTING_HINT,\
dmnQBne,\
UNRESOLVED_HINTne,\
dsuMODIFYINGkuhe,\
PLUGGABLE_PROTOCOLsiama,\
LOCKINGpzlne ,\
LOCKINGpzDEADLOCK,\
LOCKINGpzrc,\
GISqnPOINTSjotOVERFLOWED,\
winwMERGED,\
?VTOKENnyTOKENnn,\
?VTOKENnyTOKENaov,\
goyooteOWNINGk,\
mjoxmuamr,\
bmyTEXT 22032,\
bmyTEXTjxs 22032,\
bmyBINARYor,\
bmyvg ,\
bmyra 22032,\
bmyrajnc 22032,\
boaobmy 22032,\
bCASTqmmy 22032,\
bmyvgra ,\
bmyvgWILDCARD ,\
mymlnkvd 22032,\
myngnkvd 22032,\
myrzASng ,\
myVACUOUSvg ,\
mytcONE_OR_ALL_ARG ,\
NUMERICmymlrmtanl 22003,\
bmymlobCAST 22018,\
myDOCUMENTnkDEEP 22032,\
myDOCUMENTqxng 22032,\
yyTRANSPORTvy,\
fyyTRANSPORTS_CONFIGURED,\
psSTORAGEna,\
nmssarn,\
nmrtni,\
moAPI_ABORT,\
bmyvgARRAY_CELL ,\
BUFPOOL_RESIZE_INPROGRESS,\
ucpsSEE_DOC,\
rpISNTwn,\
vlWAS_KILLED,\
CAPACITYpg,\
CAPACITYpgjnlOPTIMIZER,\
?eNEEDS_UPGwd,\
gWAITobuhkoyWHILE_OWNING_Ak,\
mdADDpcBASEvfxk,\
mdmxxkmvnq,\
csuMODIFYINGkuhe,\
qwREFUSED_BYna,\
mkofONLINEsuxkmf,\
qdngrkamaBY_SE,\
?qdngrkcBY_SE,\
qdngrkmcmh,\
qdngrkSE_UNAVAILABLE,\
mmmdENCRYPT,\
bmpoc,\
mdFINDngjpd,\
CAPACITYpgjqp,\
mkofmpINPLACE,\
pdrepdpzc,\
nmmfOLDrd,\
gRESETnj,\
nsmzqnnspm,\
mdADDpcBASEvfyz,\
eql,\
?mbnameobe,\
?dznGEOMFROMWKBqmoySRID_ZERO 01000,\
?dznGEOMFROMWKBqmoySRID 01000,\
XA_RETRY,\
pdAWSreAWS_KMSc,\
mcnfXA,\
rec,\
pdMIGRATIONon,\
pdojpjc ,\
pdMIGRATION_STATUS,\
?nymhqmqyqq,\
?nymhqmqye,\
?moifpdnyINSTALLED,\
?moimpmtHASaBEENoy,\
?moiCOULDamxAESng,\
?moimpmtmdylFETCHED,\
?moimyFILTERINGaENABLED,\
?moirewhpw,\
?moiSUPERpwvy,\
?COULDaREINITIALIZEmoivk,\
?moirebpfoa,\
?moirebpfsp,\
?moiHASaBEEN_INSTALLED,\
?moirepbbqnARRAYrdARGoa,\
moirepbbqnARRAYrdARGml,\
?moimyqczuc,\
?moimyqcnemdylpp,\
?moimynmnemdylpp,\
?moimyqcssani,\
?moinmFIRSTowryylALPHANUMERIC,\
?moinmnebow,\
?moizgnebow,\
!OBSOLETEdmeMAXDBwinwobri,\
?XAmzvk,\
?gqyci,\
?xysurijDST,\
?gwmrpNAMED_PIPE,\
sroyrvqb,\
?meTLSqivl57,\
?dmeTLSqi57,\
?dlvteSTRUCTURE,\
AESbKDFne,\
AESbKDF_ITERATIONS,\
!dAESngpm,\
AESbKDFocpm,\
@3500,\
UNSUPPORT_COMPRESSEDvae,\
ACLmumh,\
mkmvsd,\
fwgDB 42Y07,\
nkvdENUM,\
nkpvoyENUMml,\
bDDsy,\
UPDATING_DDe,\
bDDsyID,\
bDDsyne,\
mmmsnhne,\
nkpvzxru,\
snstmh,\
bBITWISE_OPERANDSpm,\
bBITWISErgOPERANDSpm,\
dmkHINT,\
ozotoa 22S01,\
qgwlc SR002,\
qgPROJtpms SR003,\
dqgaov 01000,\
qgaCARTESIAN 22S00,\
qgaCARTESIAN_UNDEFINED SR001,\
PKmvgylINVISIBLE,\
mnAUTHID,\
mhwyrf,\
qywyqq,\
mhnpROLES,\
ohfSCHEME,\
ohfSCHEMEpz,\
ohgst,\
wyaGRANTED,\
mhREVOKEwy,\
RENAMEwy,\
ohgACQUIREpzyj,\
ohgSATISFY_DEPENDENCY,\
ohstgREGISTERpzyj,\
ohstgINITIALIZE,\
ohxeaLOADED,\
ohxegDEINITIALIZE,\
ohgRELEASEpz,\
ohxegUNREGISTERpz,\
ohgxe,\
dxeTHEawr,\
mieuw,\
miMANIPULATEqomh,\
ohxepkjns,\
goykvvDUE_SETS_CONSTRAINTS,\
mdqwnmMANAGEMENT_CACHES,\
qgaov SR001,\
ooawr,\
ulsbbsw,\
usqmxtvp,\
fosodoj,\
fosmmoj,\
foseoj,\
foseojobDICTIONARYe,\
foseojobose,\
foseojobe,\
bocng 22023,\
bocml 22023,\
bocngmlPAIR 22023,\
bocwmow 22023,\
bocENDow 22023,\
bocCHARACTERS 22023,\
pkocng 22023,\
dqgaovAXISsa 01000,\
fojqmvtFCT,\
RESETnjqmmlrmtanl,\
UNRESOLVEDeqw,\
pkeqw,\
mcnfSKIPyt,\
mcnfNOWAIT,\
qwNOWAIT,\
CTErhpuUNION,\
CTErhpuNONRECURSIVE_FIRST,\
CTErhFORBIDS_AGGREGATION,\
CTErhFORBIDDEN_JOINsa,\
CTErhpuSINGLEtq,\
rrTMPna,\
nofwgno,\
noCIRCULARITYjnoGRAPH,\
nofzkPARTITIONING,\
nofINHERITwk,\
nofREDEFINEsaBY,\
nowkwmpy,\
nowkENDpy,\
nowkpy,\
nonlwksaoa,\
nonlwkTEMPORALoa,\
nonlwkNUMERICoa,\
nonlBOUNDaCONSTANT,\
nopkne,\
nopysaBY,\
nobnotdtt,\
nobnotdALIAStt,\
noyunotdttjnoSPEC,\
noROWSxztt,\
nofnssars,\
noslmy,\
noncIGNORESwk,\
WL9236_NOWrs,\
bftaARGS,\
oijxyansBY,\
nkpvmmru,\
nagphe,\
nagphmse,\
mmumFILENAME,\
DBphRMDIR2,\
IMPfwjMATCHED,\
IMPodssarn,\
IMPertni,\
IMPoqMYSQLDqi,\
IMPoqDDqi,\
IMPoqSDIqi,\
dbHINT,\
vzssarn,\
LONGITUDErmtanl 22S02,\
yarmtanl 22S03,\
aquobGEOGRAPHICqg 22S00,\
pypwLEVEL,\
fospnoj,\
miqcFLABBERGASTED,\
wdEXPRnkpv,\
rephDYNAMICALLY_REGISTERED,\
usqmxtmfvp,\
usqmommfvp,\
usqmphmfvp,\
usqmBUILD_HISTOGRAM,\
sewy,\
msmmnt,\
zvpiojpjc ,\
?CMD_NEED_SUPER,\
vgjDATADIR,\
qvDDLjPROGRESS,\
qvnkshyfCLONES,\
qziogvqc,\
CTEqnuyDEPTH,\
aHINT_UPDATABLEoo,\
CREDENTIALS_CONTRADICTqmHISTORY,\
zzmtHISTORY_CLAUSES_VOID,\
okssaSUPPORT,\
I_Szymm,\
mmnann,\
lSRIDobmf,\
mdofSRID_DUEqmmv,\
dmcudUPDATESps,\
?dmcV1qoEVENTSps,\
dmcudUPDATES_SUGGESTSudIMAGES,\
COULDaAPPLYmyDIFF,\
uumyDIFF,\
rjnsni,\
rjnsani,\
bVCPU_ID,\
bVCPUnl,\
bqrPRIORITY,\
vmmu,\
rjnsBUSY,\
rjnsps,\
ucmk,\
qjrw,\
bqrID,\
rjnsBINDmh,\
btttaFORCEoc,\
nsmzsion,\
SDImumh,\
msmyeml 22035,\
lmyeml 2203F,\
TFrywbALIAS ,\
TF_FORBIDDEN_JOINoa,\
JTmlrmtanl 22003,\
JTqnyuvg ,\
mtEXPIRATIONamaBYzeMETHOD,\
bzsCRSaTOP_LEVEL,\
tcqxcarw 23000,\
!dUSELESSuemv,\
DISK_FULL_NOWAIT,\
wlcjDIGEST_FN,\
UNDISCLOSEDwlcjDIGEST_FN,\
odDIRni,\
odDIRms,\
odDIRmxmh,\
odDIRmn,\
piquobSRID_0ts4326 22S00,\
?mcEXPIREiDAYStsSECSrzTOGETHER,\
olyouj,\
olpypf,\
olmvOUTOFBOUNDSc,\
olINTERNALc,\
olRULEsz,\
oltcESCAPE_SEQUENCE,\
olUNIMPLEMENTED,\
olMISMATCHED_PAREN,\
oltcxz,\
olqnLT_MIN,\
olbBACK_REF,\
olLOOK_BEHINDqb,\
olmsCLOSE_BRACKET,\
olbnl,\
olSTACKuj,\
olTIMErm,\
olPATTERNnkvd,\
goycipz,\
ppPIPELINEobcipz,\
miqcDIAGNOSTICS,\
aquobCARTESIANqg 22S00,\
aquobPROJECTEDqg 22S00,\
NONPOSITIVE_RADIUS 22003,\
RESTARTrpmh,\
qgmsseqj SR006,\
qgpaqjDEFINITIONS SR006,\
qgnegylppOR_WHITESPACE SR006,\
qgORGANIZATIONgylppOR_WHITESPACE SR006,\
qgIDrtni SR004,\
dqgIDrtni 01S00,\
gMODIFY_SRID_0 SR000,\
dRESERVED_SRIDnl 01S01,\
gMODIFYqgrzBYmf SR005,\
qgbowjqj SR006,\
qgqjrqnkpv SR006,\
meUTF8_ALIAS,\
meNATIONAL,\
bnpUTF8MB4tl,\
usqmCOLLECTiSTATUS,\
RESERVEDmmne,\
usqmoyoc,\
mjPOSSIBLY_DIVERGEDtfDDL,\
qgaGEOGRAPHIC 22S00,\
POLYGONnkzm 22023,\
uezbmv,\
mvoaamaobuemv,\
wwmdphxc,\
otxsLONGITUDErmtanl 22S02,\
otxsyarmtanl 22S03,\
wwmdttxkmf,\
wwfmfxc,\
goycSUPPRESSIONtu,\
qgGEOGCSbAXES SR002,\
qgbSEMI_MAJOR_AXIS SR002,\
qgbINVERSE_FLATTENING SR002,\
qgbANGULAR_UNIT SR002,\
qgbPRIME_MERIDIAN SR002,\
vbnjqgama 22S00,\
vbzaqgama 22S00,\
vbnjqgmsTOWGS84 22S00,\
vbzaqgmsTOWGS84 22S00,\
uaeptrrvlmcnx,\
uaeptrrypmcnx,\
rbqzptrrypmcnx,\
okknfmxphuaejTRXjSBR,\
?XAgmxMDL_BACKUP,\
eprPK,\
dortrnumv 01000,\
dorrmtanlnumv 22003,\
numvsumyORotnc ,\
numvREFqhto,\
mdphmfnumv,\
numvtkng,\
numvsuLOB,\
numvnculamr,\
xxnumv,\
uenumv,\
lngmfnumv,\
numvsuoi,\
ndmfNAMEDnculamr,\
ndmfqoml,\
ndmfvc,\
uvBYnpndml,\
npVALndsoPRIOR,\
npVALndREFqhINC,\
npVALndnculamr,\
npVALndNAMEDnculamr,\
npVALndqoml,\
npVALndvc,\
npAS_VALnd,\
mkACTIONsunpVALnd,\
knfofADDvfnhnpEXPRESSION,\
wwmdmwna,\
dmenmoyEXPR,\
dmeUTF8MB3tl,\
dmeyurusz,\
wwoqth,\
GR_HOLD_WAITrc,\
GR_HOLD_KILLED,\
GR_HOLD_MEMBER_STATUSc,\
rlmpmhqmFETCHng,\
rlmpngaov,\
rlmppdbng,\
rlmpsxc,\
rlmpmhqmyxLOGS,\
rlmpngnioz,\
rlmpmhqmGENERATEng,\
rlmpmhqmxtng,\
rlmpmhqmREMOVEng,\
rlmpusqmmwoc,\
rlmpqdngscmh,\
SLOWinwrwteatjqmnt,\
wxTRXqtamr,\
wxTRXqtyn,\
wxTRXqttfsuTRX_BEGIN,\
wxTRXqtBEGINamr,\
numvqomlulamr,\
rlmpmhqmENCRYPT,\
PAGE_TRACKINGaSTARTED,\
PAGE_TRACKINGnlaTRACKED,\
PAGE_TRACKINGmdvi,\
rlmpmdyxmcqdng,\
mcqdngscrmtaCOMBINATION,\
mcqdngrkwaqmOPERATEng,\
mcqdngrkwaqmyxLOGS,\
mcqdngrkwaqmREENCRYPTi,\
mcqdngrkwaqmCLEANUPrsKEYS,\
mcqdngrkwaqmCLEANUP_AUXng,\
soBOOLEAN_EXPRobponq,\
mfponqREFERENCES_OTHERmf,\
ponqNAMEDnculamr,\
ponqnculamr,\
ponqvc,\
ponqqoml,\
ponqREFERSqhtomf,\
ponqVIOLATED,\
ponqREFERSmnmf,\
ponqaov,\
ponqumne,\
ponqswznwwREFER_ACTIONmf,\
!dUNENCRYPTEDejENCRYPTED_DB,\
bmpREQUEST,\
mdoyemp,\
mdoyDATABASEmp,\
mdoymmmp,\
mmmdylENCRYPTED,\
mmmdylDECRYPTED,\
mmoamn,\
zammUNENCRYPTED,\
mdttmpsw,\
bpaCLAUSES,\
mktttarfAS,\
UKNOWNzeID_ORojpjobrfAS,\
uvBYnumv,\
nyaEARLY,\
mqtvipxwmSUBDIRvg,\
mqtvipxwmrc,\
mqtvipxDIRSb,\
mqtvipxLABELaov,\
mqtvipxDIRpp,\
mqtvipxfwgDIR,\
mqtvipxDIR_CLASH,\
mqtvipxDIR_PERMISSIONS,\
mqtvipxntmx,\
mqtvipxym,\
mqtvipxINACTIVE,\
mqtvipxmh,\
mqtvipxvl,\
zdREGEXc,\
bmyoa 22032,\
mdvjrq,\
uvBYmbtd,\
dmeFLOATqhto,\
rlgwfmjWHILEytBACKUP,\
dmeFLOAT_DIGITS,\
dmeFLOAT_UNSIGNED,\
dmeINTEGER_DISPLAY_WIDTH,\
dmeZEROFILL,\
qvDONOR,\
qvPROTOCOL,\
qvDONORqi,\
qvOS,\
qvPLATFORM,\
qvra,\
qvCONFIG,\
qvSYS_CONFIG,\
qvnyvh,\
qvLOOPBACK,\
qvmp,\
qvDISK_SPACE,\
qvjPROGRESS,\
qvvm,\
mdrfROLESqmopnm,\
uznany,\
SECONDmtmdylpp,\
DBojpj,\
xozeIDnhosnmPRIVjseROLES,\
xorlkemdqy,\
otjmnrdUNIT SU001,\
xonyxhc,\
fvlua,\
xomncvu,\
mfmwpm,\
olbCAPTUREnsne,\
xoSSL_LIBRARYc,\
uzna,\
uznaDDL,\
uwzpmt,\
mszpmt,\
zpmtavy,\
mtmdylRETAINEDsunymw,\
zpmtmdylRETAINED,\
udREVOKESrn,\
mdrfosPRIVqmsewy,\
XAmzvk,\
mkwinw,\
olbFLAG,\
udREVOKEtsDBrfBOTHni,\
UNITaov SU001,\
bmymlobtdmv 22018,\
mymlrmtanlobtdmv 22003,\
pgMV_KEYS_NUM,\
pgMV_KEYS_SPACE,\
numvorulnkpv 22001,\
lMVIml,\
dtdmvaAPPLICABLE,\
wxrlrec,\
omkvvnhGR,\
xysurijDST,\
eneCAUSESnkpvvg,\
moiwhpw,\
?moimtHAS_BEEN_COPIED,\
xowxrlSTARTEDqhREJOIN,\
SYSVARmwuqsb,\
GLOBSTATmwuqsb,\
wxrlMESSAGEpzzhon,\
mwnjlqssdok,\
mwnjlqsLEVELok,\
lqssdok,\
lqsLEVELok,\
mwnjlqssdtuok,\
okpwwznmmdylop,\
okpwwznmssarn,\
okpwwznmsj,\
okpwwznmNEEDSrlqzPRIV,\
dxopwaREGISTERED,\
okpdrengb,\
okpdrengoab,\
okpdrengnkpv,\
okpdrengoankpv,\
myodvqcnhDETAILED_REPORT,\
xorebrawv,\
xorebra,\
xorebtl,\
xorebEXTENSIONpfoa,\
paCONSTRAINTSnhwene,\
nqaov,\
ofnqENFORCEMENTama,\
emlCONSTRUCTORrywbth,\
emlCONSTRUCTORmdwbnp,\
oksbonbsoqonx,\
REQUIREqonxbml,\
mhqmDETERMINE_IFwyulse,\
mhqmFETCHsewytu,\
okLOCALwjps ,\
IMPoqCFGqi,\
xoOOM,\
xorebpfqmoyra,\
xorebRETURNoaqmoyra,\
paINTO_CLAUSES,\
MISPLACED_INTO,\
nmojpjobnmACCOUNT_BLOCKED_BYmtqw,\
dmeYEAR_UNSIGNED,\
qvNETWORKyv,\
SDImumhmsyw,\
uvBYponq,\
wxmuamrGRrywf,\
dmemyesucsupp,\
dmeINNER_INTO,\
dmeutncALWAYSqx,\
dmewiCALCovROWS,\
dmeovROWS,\
msmyml 22035,\
pamyut 22034,\
HOSTNAMEnkpv,\
?dokmembPREFIXng,\
nsmznmppMSG,\
nsmznmseMSG,\
nsmzmtrd,\
ydvbREJECTED,\
xowxrlscENDPOINTnx,\
xowxrlscENDPOINTb,\
lmlobvzPLUS_ACTIONABLEwd,\
peamrtfwmnb,\
pcngnhATOMICmxoe,\
amrnhwmnb,\
bmyqj,\
naqjama,\
bnmqjmy,\
mqtvps,\
mqtvARCHIVING_ENABLED,\
MDLrmtaRESOURCES,\
IMPLICIT_COMPARISONobmy,\
ncssaSUPPORTowoy,\
IMPOSSIBLErqqk,\
odpbpi,\
rlASYNCwtknwxp,\
rlASYNCwtqhtbxp,\
skknwpuASYNCwtxp,\
skqhtbpuASYNCwtxp,\
btptt,\
owoynn,\
dvzmlmwama,\
bTIME_ZONExz,\
bCAST,\
ygamaYET ,\
?dygEXPERIMENTAL,\
xofciqpCONFIGURED,\
xocieps,\
xocipavk,\
xogqyci,\
nmqlASzr,\
mdnmqlASzr,\
REGEXvunkvd,\
SPVAR_NONINTEGERoa,\
!dmkACLqqpb,\
mcnfACLepbjDML_DDL,\
wfmjMONITOR_IOqrrc,\
STARTINGmjMONITOR_IOqr,\
gttopqmknhknwasu,\
gCOMBINEopqmktsAUTOPOSITION,\
ASSIGNxrqmopTRANSACTIONSpuknwsu,\
wimjSKIP_COUNTERrznhknwsu,\
znASSIGNxrqmopTRANSACTIONS_AS_LOCAL_ORzi,\
?oykqmANONtsWAIT_UNTILwiTHDtfxr,\
goywitfORynxrnhopqmk,\
opqmkziweASnsne,\
gttweziASnsne,\
wxrlscoxSTILLrb,\
mqbyepmml,\
mqoqnhmm,\
mqyepmrmtanl,\
mdttyepmsw,\
wyGRANTEDqmITSELF,\
erywbA_VISIBLEmf,\
mqqson,\
dASYNC_CONN_FAILOVER_NETWORK_NAMESPACE,\
okINTERACTIONrc,\
bCASTqmot 22S01,\
bCAST_POLYGON_RING_DIRECTION 22S04,\
GIStnSRIDS_AGGREGATION 22S05,\
RELOADpdon,\
SDI_GET_KEYSbmm,\
mwrlSRClqssdpm,\
?dmeTLSqioboxCLI,\
gttweziASpnmwzi,\
opqmkziweASpnmwzi,\
wxrlpnmwziwaGEToo,\
dADUITiqnpmtsPRUNE_SECONDS,\
dADUITiqnpmCLOSEqmyxsupm,\
KERBEROSmxnm,\
xhnyufok,\
xocimiFLUSHmh,\
dwitfMTS_GAPS_GAPaCALCULATED,\
bASSIGNMENTza ,\
muamrsuGRuz,\
wxrlFAILOVERoxSTATUS_PROPAGATION,\
dmoinxUNIXripitemy,\
bMFAnywv,\
IDENTIFIED_BYmk,\
bnyobsf,\
nypusf,\
MFA_METHODni,\
MFA_METHODani,\
AUTHENTICATIONqenn,\
nysfDONE,\
bnmobsf,\
nmsfmh,\
MFA_METHODSbsa,\
MFA_METHODS_IDENTICAL,\
bMFA_OPERATIONSobPASSWORDLESSnm,\
mwmznjfOPTIONSobkpi,\
mwREPnjgskREQqonxnhkpi,\
mwREPnjgskqhtbnhkpi,\
mwREPnjgskkpiprPOSITIONS,\
mwREPnjgskqhPOSprPOSITIONS,\
mwREPnjGRoxnhknwasu,\
gttkpinhknwasu,\
dCskkpinhnjqhPOSbPOS,\
xoSSL_FIPSnwc,\
mlrmtanl,\
xxnhROLLUP,\
olmsrj,\
dolznnp,\
olmsnt,\
dmetl,\
yfwsUSAGE,\
xoypCONNqb,\
xoCONNqb,\
ofmuamaqfmfoaxi,\
dSFrenewo,\
mdvimcnhBACKUPqw,\
nkshWINDOWS,\
MYSQLBACKUPokMSG,\
ruCONTAINSbrq,\
mgCONTAINSbrq,\
gEXECUTEsinhASSIGNEDktz,\
XAuae,\
mqqnqoqi,\
?mqxiADDamaqnpm,\
muamrWHILEtkmwulrb,\
dmexvDELIMITER,\
dmeSUPERFLUOUS_DELIMITER,\
mdzvSENSITIVEvc,\
dmdSECURELYzvSENSITIVEvc,\
dvertni,\
IFanimkvenisutne,\
IFanimkrevtFCTnewo,\
oymtzenyc,\
?REDUCED_DBLWRntuu,\
?REDUCED_DBLWR_PAGEov,\
qgbyataORIGIN SR002,\
qgbLONGITUDEtaORIGIN SR002,\
qgrsPROJtpPRESENT SR002,\
GIPKmfni,\
GIPKmhubmfni,\
GIPKmfofamr,\
phPKmfqmphGIPK,\
mxoenhGIPKvmjSBR,\
?xoEXPIRE_LOGS_DAYSrw,\
CTErhaUNION,\
siBACKENDmhqmFETCH_SECURITY_CTX,\
sipzBACKENDmh,\
okntpwobmzwz,\
nsmzFORCE_MEMBERSsion,\
dmeIDENT,\
INTERSECT_ALLqnDUPLICATESpg,\
TPsbTHRS_PERwxrvTXN_THRqb,\
tcrinx,\
SHAPE_PRIDICTIONre,\
qgbHEIGHT SR002,\
qgbSCALING SR002,\
qgbZONE_WIDTH SR002,\
qgbyaPOLAR_STEREvzA SR002,\
dmeokfodoc,\
eapp,\
eftkng,\
ejSHAREDmm,\
mvOTHER_THAN_PK,\
stnzorUNSORTED,\
nzEXECUTORc,\
nzroztzhmh,\
nzroztc,\
nzrorpc,\
nzrovrc,\
nzstormh,\
nzysmfnkvdobLEFTOVERyo,\
nzysmic,\
nzysntCONTAINS_LESS_LINES_THANyrsw,\
nzqpmsENCLOSED_BY,\
nzqpqoyoqnTOTAL_COLSpg,\
nzqpCOPYyopmpg,\
nzqpozENDtaINPUT,\
nzqpozqoyi,\
nzqpozCHARtfENDING_ENCLOSED_BY,\
nzqpozCHARtfqxESCAPE,\
nzqpozCHARtfmfyi,\
nzqpINCOMPLETE_ESCAPE_SEQUENCE,\
stnzormh,\
stnzorlmloboi,\
stnzordqxqmNOTNULL,\
REQUIREetkngpoGENERATEnhGR,\
gmwSYSvzjpbpinw,\
mqxiADDphamaqnpm,\
mqxiADDamaqntx,\
goywr,\
xhmioyqxml,\
xhmioyrsml,\
dmenmzqCOLLATIONS,\
nmqwOVERLONGne ,\
dfSPACEqiru,\
VALIDATEmtwhzoCHARACTERS,\
dmenhNOTE,\
gRUNsiSERVICES_RECURSIVELY,\
dmoiqcsctjps,\
@6000,\
oumi,\
oumiawn,\
oumimkou,\
oumimdUNINSTALL,\
snfofou,\
?slINTO_ANALYZEama 0A000,\
slINTO_IMPLICITnxama 0A000,\
slINTOnxama 0A000,\
qxgylwrobyb,\
slINTOobsmama 0A000,\
mqxblDROPPED_ENUMrd,\
mqxblvutaINDEXES_ZERO,\
mqxblvutaINDEXESnkHIGH,\
mqxbphvfuinn,\
mqxbENUMqxyims,\
SIMULATED_INJECTIONc,\
dmeDYNAMIC_PRIVjrf,\
nzMULTIroqyntmh,\
nzMULTIropbntmh,\
nzMERGEbCHUNK,\
nzMERGEaALL_CHUNKS_CONSUMED,\
nzWRITERztzhmh,\
nzWRITERztc,\
nzSORTINGyssr,\
nzSORTINGysWAIT,\
nzroqyntmh,\
nzsteHASxiCOLS,\
nzstrj,\
nzstuzna,\
nzroc,\
nzrontuprn,\
nzroCOULDNT_RESOLVEzg,\
wmmjoxbvs,\
mdEXECUTEjtk,\
nkshnsBY_MODIFIER_BRANCHES,\
dmenaszfREPLACEMENT,\
QUALIFYprnonc,\
mapinhyg,\
SPECIFICojpj,\
goyktzqmAUTOMATIC_TAGGEDteknwulxp,\
ktzTAGknwxp,\
hvfaNULLABLE,\
hdvfmsaNULLABLE,\
hvfulpp,\
hvfulppd,\
htcml,\
hxfmnsv,\
hxfOOMsv,\
hdxfROUNDING,\
hxfPRECISIONrvod,\
hrvMIN,\
hrvqn,\
hdrvMIN_TRUNCATING,\
hdrvqnTRUNCATING,\
hREALulNAN,\
hrmtanl,\
hxvnx,\
hdtr,\
hmdvjrq,\
hrjPRINCIPALsv,\
hAWSzesv,\
hCSVzusv,\
hmfnnsv,\
hmfqnsv,\
hramk,\
hrxxfqksv,\
hrqnkpv,\
hrjPRINCIPAL_BUCKETsv,\
hfwjov,\
hppnt,\
hpknt,\
hsgodDEPTHrvqn,\
hsgsxnn,\
hsgENUMmdvjra,\
hsgENUMnn,\
hsgoamdvj,\
hsgntENDS_UNEXPECTEDLY,\
hsgntorsj,\
hsgbUNION,\
hsgbBLOCKpm,\
hsgbBLOCKywsp,\
hnxsxfMAGIC_BYTES,\
hsgsxuisv,\
hsgsxfod,\
hsgfCODECjsx,\
hsgbnejod,\
hsgDECODINGsv,\
hrxsoUTF8ntENC,\
hrxodnn,\
hrxqonspmrvqn,\
hrxmdLOCATE_OFFSET,\
hrxoamdvj,\
hrxmdLOCATEod,\
hsqNUMvfnn,\
hOOM,\
hdsqzyLINES,\
hdsqzywj,\
hsqntHASfor,\
hsqfor,\
hsqfwj,\
hdsqttnpvfNAMES,\
hrxmdpbsx,\
hsqdGOTpl,\
hsgmdwlsx,\
hrxgqynt,\
hnkzmmlsv,\
hnkzmqosv,\
TABLESAMPLE_PERCENTAGE 2202H,\
TABLESAMPLEpisuBASEqq,\
?tpmvrmtanl,\
RESULTpmqbpg,\
oumiINTERNAL,\
oumiCONCURRENCYqb,\
oumiRUNTIME,\
oumiTIMEZONE,\
oumiKEYWORD,\
oumioyosoo,\
oumimkoa,\
oumiqk,\
dsnpePARTIALLYuh,\
twEXECUTIONamrWITHINsnORveORre,\
hmyzu,\
namdylnp,\
mbPREFIXngama,\
dmesoSTANDARDng,\
wwfzbmvxc,\
ojpjfPROXYrf,\
ojpjfPROXY,\
hnmorojmh,\
nzroZSTDc,\
nzqpc,\
hbmyntnxod,\
hsqmybod,\
hmyntnxdsqod,\
soSCALARrzASng,\
oqoaAGG,\
oroqnhvw,\
rvvwqnDIMENSIONS,\
qmvwqk,\
?vxmkmvsd,\
TPmdskMTLnhDL,\
wxrlsmHANDOFF_BUSY,\
@6400,\
rpOFFLINEnwqf,\
?rpOFFLINEnwnm,\
hnrforov,\
hnrntwlsv,\
hnrENCODINGsv,\
hnrntoannsv,\
hnrodsv,\
hmfnaATTRsv,\
hnrOBJpbsv,\
hfSEGMENTSnd,\
hnrntnkzm,\
pgqnREGULARpeyqqb,\
slANALYZEmynxqiama 0A000,\
soDML_DYNAMICvn,\
DEPRECATEsoCOMPOSABLEpana,\
nzmyb,\
nzBLOBnkvd,\
fsbPLANov,\
hCPnkshCHANGES,\
hCPaENABLED,\
hCPfvwxt,\
hCPfvqnw,\
?hCPmswjnw,\
hCPxamh,\
hnrbou,\
hvwnkshENTRIES,\
nzqpozENCLOSED_BYow,\
CMD_NEED_SUPER_ORmxuetqos,\
swrw,\
bswjCONTEXT,\
bswCOMBINATION,\
dREDACTED_PRIVILEGES,\
bOUTERtq,\
LIBRARIESama,\
hdSUMMARY,\
hdsqttnpDELIMITERS,\
LIBRARYb,\
mdzvnbISOLATION,\
hsgbyw,\
hbmljvw,\
hdvwLOSSYqk,\
hnrTRUNCATIONc,\
hnrPAGE_CHUNKd,\
hnrnkshCHUNKS,\
ojpjFIREWALL 28000,\
hDECOMPRESSIONsv,\
nvbmglxl,\
nvALGO_TEMPTABLEama,\
nvnhpoocama,\
nvbmgsoSIMPLEoeama,\
nvbmgCTEama,\
nvbmgGROUPBYama,\
nvbmgnoncama,\
nvbmgqbama,\
nvbmgORDERBYama,\
nvbmgMULTIqqama,\
nvbmgfWHEREtmjSUBOBJECT,\
nvbmgWHEREtmjROOTOBJECT,\
nvbmglWHEREnxobSUBOBJECT,\
nvbmgloioa,\
nvbmgCONTEXT_PREPAREmh,\
nvbmgfmysyjROOT,\
nvbmgMUSTBEmysyobSINGLETON,\
nvbmgMUSTBEmysyobyu,\
nvbmgfmyOBJjARRAYAGG,\
nvbmgRELATIONSHIP_RULES_VIOLATED,\
nvbmgmfoaama,\
nvbmgsoBASEeama,\
nvbmgeprPKov,\
nvbmgeprPK_PROJECTIONov,\
nvbmgIDngrzBYaROOTe,\
nvbmgIDngarzBY_ROOTe,\
nvbexlobSINGLETON_OBJ,\
nvbexlobyuOBJ,\
nvbmgpkKEYSama,\
nvbmgpkmfama,\
nvbmgweeqaPROJECTION,\
nvbmgmftuama,\
nvbmgqaeoijTHEsy,\
nvbmgWHERE_USESsoIMMEDIATExc,\
nvbmgCOMPOSITEngrz,\
nvbmgALIASarzobweqq,\
nvmuama 0A000,\
nvofORzwama,\
nvbmyDUALITYsyUSAGE,\
nvozmyoa,\
nvtkngryylPROVIDED,\
nvJOINtmaSATISFIED,\
nvPK_DUPLICATESaIDENTICAL,\
nvUNMAPPEDng,\
nvmsurTAG,\
nvmsybSUBOBJECT,\
nvJOINtmVIOLATION,\
nvmsETAG,\
nvETAGnn,\
nvmsml,\
nvPK_UPDATESamr,\
nvmsomTAG,\
nvmsuoTAG,\
nvqxurml,\
nvurmlaFIXED,\
nvqxomml,\
nvommlaFIXED,\
?nvucEDITIONqb,\
nvmdylrznh,\
nvDMLwc,\
?nvmsmlobAGmf,\
nvbBINARYoasx,\
ETAGama,\
naqjuf,\
vxnxama,\
vxeboc,\
vxenaama,\
vxenaawv,\
hfwjovfyyntPRIV,\
hvfnems,\
hvfnepk,\
hnrOCI_GENAIon,\
hnrudntwlsv,\
nvEXPLICITqhtoamr,\
hsqvfnenn,\
hDELTAodnn,\
hDELTAuipbc,\
hDELTAmkc,\
dACCOUNT_TRIMMED,\
hdxvpaxstt,\
hGENCOLc,\
TEMPORALncuj 22008,\
hsqmfqnsv,\
hEXTRAthjnt,\
hrxCOMPLEXqk,\
moips,\
moimimyqczuc,\
moimhqmqyqq,\
moimhqmqye,\
moimimyqcnemdylpp,\
moiminmnebow,\
moifpdINSTALLED,\
moimimdpbmt,\
moimizgnebow,\
moimimynmnemdylpp,\
moimipdIDrimlulb,\
moimirebpfoa,\
moimirebpfsp,\
moiABORT,\
moiCOULDaRELOADvk,\
moirebpfqx,\
moiqnpmCLOSEqmyxsupm,\
moiqnpmtsPRUNE_SECONDS_PRECEDENCE,\
moimtHASaBEENoy,\
moibemg,\
moimiqcmhqmxteFLDS,\
moimiqcmhqmzheobpb,\
moimiqcmhqmuoFROMe,\
moimyqcssarnnm,\
hCUSTOMorPLACEMENT_OVERRIDES,\
hsgwjoroann,\
moimibqcABORT,\
moimimybqcmdylrz,\
dmoivkb,\
nvndtsEXPLICIT_PKSamr,\
pqqemic,\
pqqertni ,\
pqqeEXPECTS_CASE ,\
pqqeEXPECTS_CASEte ,\
pqqemsELSE ,\
pqqeONEtevy ,\
pqqeryRETURNpf ,\
pqqebGATEKEEPER ,\
pqqesoLITERAL_GATEKEEPER_ARG ,\
pqqevmCONSTRUCT ,\
pqqebmftq ,\
pqqeoqmfuc ,\
pqqeoqTYPES ,\
pqqesoDETERMINISTICtd ,\
wwqnqqjCASCADE_CHAINpg,\
wwCASCADExjUPDATINGwwthama,\
gomrzejwwCASCADE,\
doyOPERATIONSyo,\
nvozbml,\
@6900,\
zfmnqzqi,\
zfqzWORKERsprmtanl,\
zfqzWORKERsppiobCSA,\
CSAmkUNTIL_COND,\
zfqzogMEMORYqbpiobCSA,\
dzfqzogMEMORYqbrmtanl,\
CSAzfDELAYEDqzama,\
CSAzfREQUIREMENTqonx,\
CSAzfREQUIREMENTkpi,\
xomdwuprmc,\
mjIDENTITYuf,\
nzrovgulDIRECTORY,\
nvmfTAGamaobyd,\
nvommfTAGamaobPK`
