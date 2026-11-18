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
export const ERROR_NAME_WORDS = 'NOT INVALID ERROR WARN TABLE NO CANT LH LOG IN GTID WRONG ACCESS ACTIVE AFTER AGGREGATE ALGORITHM ALLOWED ALREADY ALTER AND ANNOTATIONS ANONYMOUS APPLIER ARCHIVE ARGUMENT ATTRIBUTE AUDIT AUTH AUTO AUTOEXTEND AUTOINC AVAILABLE AVRO BAD BE BEFORE BIG BINLOG BOOST BUFFER BULK CACHE CANNOT CHANGE CHANGED CHANNEL CHARACTER CHARSET CHECK CHECKS CHILD CLAUSE CLIENT CLONE COL COLLATION COLLISION COLUMN COLUMNS COMMAND COMMENT COMMIT COMMUNICATION COMPLETE COMPONENT COMPONENTS COMPRESSION CONCURRENT CONDITION CONFIGURATION CONFLICT CONNECTION CONSISTENCY CONSTRAINT CONVERSION CONVERT CORRUPT CORRUPTED COUNT CREATE CREATION CRST CURRENT CURSOR DA DATA DATETIME DECIMAL DEFAULT DEFINED DEFINER DEFINITION DELETE DENIED DEPENDENT DEPRECATED DIFFERENT DISABLE DISABLED DISALLOWED DOES DOESNT DROP DUP DUPLICATE DURING EMPTY ENCRYPTION ENGINE ENTRY ERR EVENT EXCEEDED EXCEEDS EXCEPTION EXCHANGE EXECUTED EXIST EXISTS EXPLAIN EXTERNAL FAIL FAILED FAILURE FEATURE FIELD FIELDS FILE FILEGROUP FILES FILTER FILTERS FK FOR FOREIGN FORMAT FOUND FPARSER FRAME FULLTEXT FUNC FUNCTION FUNCTIONAL GENERATED GEOJSON GEOMETRY GLOBAL GRANT GROUP GROUPING GRP GTIDS HANDLE HANDLER HAVE HEADER HEARTBEAT HOST HYPERGRAPH IGNORE IGNORED ILLEGAL IMPLEMENTATION IMPLEMENTED IMPORT INCOMPATIBLE INCONSISTENT INCORRECT INCREMENT INDEX INFER INFO INIT INNODB INSERT INSTALL INSTANT INSUFFICIENT INTERRUPTED INTERVAL IS JDV JSON KEY KEYRING LANGUAGE LARGE LATITUDE LENGTH LIBCURL LIMIT LIST LOAD LOADER LOCK LOCKED LOGGING LONG MALFORMED MANDATORY MANY MASKING MASTER MATCH MAX METADATA MISMATCH MISSING MODE MULTIPLE MUST NAME NATIVE NESTED NET NEXT NON NONEXISTING NONPARTITIONED NULL NUMBER OBJECT OF OFF ON ONLY OPEN OPERATION OPTION ORDER OUT OVERFLOW PACKET PARAM PARAMETER PARAMETERS PARENT PARQUET PARSE PARSER PARSING PART PARTIAL PARTITION PARTITIONS PASSWORD PATH PERSIST PERSISTED PLUGIN POLICY POSITION PREVENTS PRIMARY PRIVILEGE PROCEDURE PURGE PURGED QUERY RANGE READ READER READONLY REASON RECONNECT RECORD RECOVERY RECURSION RECURSIVE REDO REFERENCE REFERENCED REGEXP REGISTRATION REPLACE REPLICA REPLICATE REPLICATION REPOSITORY REQUIRED REQUIRES RESOURCE ROLE ROLLBACK ROTATE ROTATION ROUTINE ROW RPL RUNNING SAME SCHEMA SECONDARY SECURE SELECT SERVER SERVICE SESSION SET SETTABLE SIGNAL SIZE SKIPPED SLAVE SOURCE SP SPATIAL SPECIFIED SQL SRS START STATEMENT STATISTICS STD STMT STOP STORE STORED STRING SUBPARTITION SUBQUERY SUCH SUPPORTED SWITCH SYNTAX SYSTEM TABLES TABLESPACE TARGET TEMP TEMPORARY TERMINATOR THREAD TIMEOUT TIMESTAMP TO TOO TRANSACTION TRANSFORM TRG TRIGGER TRUNCATED TYPE UDF UNABLE UNEXPECTED UNIQUE UNKNOWN UNLOAD UNSAFE UNSTRUCTURED UNSUPPORTED UNUSED UPDATE USE USED USER USING UUID VALIDATION VALUE VALUES VAR VARIABLE VARIABLES VECTOR VERSION VIEW VIRTUAL WARNING WHEN WINDOW WITH WITHOUT WRITE'

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
goqqm,\
goqe,\
goqDB,\
DBoqqd,\
DBpnqd,\
?DBpnpd,\
DBpnRMDIR,\
?gpdqm,\
gFINDycREC,\
gGET_STAT,\
?gGET_WD,\
gtb,\
guhqm,\
qmaqv,\
gvpDIR,\
?gxbWD,\
CHECKREAD,\
?DISK_FULL,\
posq 23000,\
?cufCLOSE,\
cufvp,\
cufRENAME,\
cufzz,\
qmzg,\
?FILSORT_ABORT,\
?FORMaqv,\
GET_ERRNO,\
ruHA,\
sqaqv,\
aFORMqm,\
aKEYFILE,\
OLD_KEYFILE,\
uhASvr,\
OUTOFMEMORY HY001,\
uludSORTMEMORY HY001,\
?ywEOF,\
CONopc 08004,\
uludRESOURCES,\
mwrqc 08S01,\
HANDSHAKEc 08S01,\
DBACCESSpec ,\
mapec 28000,\
fDBc 3D000,\
yyCOMc 08S01,\
mwuac 23000,\
mwDBc ,\
eqdc 42S01,\
mwec 42S02,\
txUNIQc 23000,\
wySHUTDOWN 08S01,\
mwqkc 42S22,\
lqkzxrh ,\
lrhqk ,\
lSUMwx ,\
lzlop 21S01,\
ynteIDENT ,\
poFIELDNAME 42S21,\
poKEYNAME ,\
popu 23000,\
lqkSPEC ,\
utc ,\
prvn ,\
NONUNIQe ,\
boz ,\
tqPRIsq ,\
ynthKEYS ,\
ynthsqPARTS ,\
yntesq ,\
sqnuplaEXITS ,\
BLOBzgASsq ,\
ynmzFIELDLENGTH ,\
lmrsq ,\
READY,\
?NORMAL_SHUTDOWN,\
?GOTxd,\
SHUTDOWNoa,\
FORCING_CLOSE 08S01,\
IPSOCKc 08S01,\
fxysc 42S12,\
lqkTERMINATORS ,\
BLOBSmifTERMINATED ,\
TEXTFILEaREADABLE,\
qmqdc,\
szse,\
mhse,\
lSUBsq,\
gREMOVE_ALLql ,\
gpnqkORsq ,\
shse,\
zeezg,\
fxyyj,\
KILLpec,\
fydzg,\
ynmzxb,\
fyxLOGFILE,\
eatcqszz,\
eatc,\
BLOBgrnoz ,\
lDBts ,\
lets ,\
ynmzwx ,\
yyc,\
yyvk ,\
lPARAMCOUNTymvk ,\
luqymvk,\
yye 42S02,\
qkxkTWICE ,\
brhqzzf,\
zcEXTENSION ,\
etrrnnv ,\
vuqmFULL,\
yynjxb ,\
ynthyd,\
ynthql,\
ynmzROWSIZE ,\
STACK_OVERRUN,\
lOUTER_JOINzd ,\
uanujsc ,\
gFINDyu,\
gINITIALIZEyu,\
yufPATHS,\
yuqd,\
guhLIBRARY,\
gFIND_DLpu,\
raapa,\
rqsnBLOCKED,\
rqaPRIVILEGED,\
vamkzh ,\
vaamf ,\
vaftk ,\
zese,\
goqyj,\
lzlopufwq 21S01,\
gREOPENe,\
bzfudua 22004,\
wbc ,\
MIXudrhqzmiql ,\
tyrg ,\
TABLEACCESSpec ,\
COLUMNACCESSpec ,\
rurgqse ,\
rglrqORzh ,\
fxye 42S02,\
tyerg ,\
amfnw ,\
ybc ,\
?UNUSED1,\
?UNUSED2,\
ABORTINGoi 08S01,\
tvunynst 08S01,\
tvvpcFROM_PIPE 08S01,\
tvFCNTLc 08S01,\
tvPACKETSuluduk 08S01,\
tvUNCOMPRESSc 08S01,\
tvvpc 08S01,\
tvvpsl 08S01,\
tvcufzz 08S01,\
tvzzsl 08S01,\
yntexv ,\
egrlBLOB ,\
egrlmrsb ,\
?UNUSED3,\
lnuts ,\
lsqnu ,\
lMRGe,\
poyx 23000,\
BLOBsqzysv ,\
vigrnua ,\
ynthROWS ,\
wjvisq ,\
?fRAID_COMPILED,\
zezysqjSAFEtp,\
sqplaEXITS ,\
nlfxye ,\
nlarw ,\
gDO_THISpqANyo 25000,\
cpqny,\
cpqwm,\
cpqFLUSH_LOGS,\
?cpqCHECKPOINT,\
NEW_ABORTINGoi 08S01,\
?DUMParw,\
?FLUSHtjnaCLOSED,\
?scREBUILD,\
xh,\
xhtvvp 08S01,\
xhtvzz 08S01,\
FT_MATCHINGsqaqv,\
tbORmbyo,\
yyyczo,\
CRASHEDufUSAGE,\
CRASHEDufREPAIR,\
zuaoawm,\
TRANSneFULL,\
?xgtrxs,\
weaws,\
mwwe,\
oitm,\
weyj,\
ynthzhCONNECTIONS ,\
xbCONSTANTSug,\
tbWAITyk,\
tbeFULL,\
vpugyo 25000,\
?pnDBzxvptb,\
?oqDBzxvptb,\
lARGUMENTS,\
fPERMISSIONymoqzh ,\
?UNIONydjphDIR,\
tbDEADLOCK 40001,\
egrlFT,\
nfADDqt,\
fwawq 23000,\
wqsnwa 23000,\
CONNECTymxh 08S01,\
?vnuftj,\
czvEXECUTINGnw,\
lUSAGE,\
lubudnvjwx 21000,\
gzezxREADLOCK,\
MIXINGamf,\
pomn,\
zhsxREACHED ,\
SPECIFICmapec ,\
LOCALzo,\
rfzo,\
foz ,\
lzlqszn ,\
lytqszn ,\
zngmxvp,\
gzfujHERE ,\
axzYET ,\
xhFATALcREADINGna,\
werte,\
sarfLOCALzn,\
lqrDEF ,\
sqREF_DOatkeREF,\
OPERANDnv 21000,\
xxf1wq 21000,\
yyxrrm,\
onHELP_DB,\
?CYCLICvz,\
mrom,\
ruvz 42S22,\
DERIVEDtrrnALIAS ,\
wxREDUCED 01000,\
TABLENAMEamfHERE ,\
axzmqtp 08004,\
xjgrnua ,\
nsnktn ,\
?xgWASws,\
?xgWASaws,\
ynmzqsUNCOMPRESS,\
ZLIB_Z_MEMc,\
ZLIB_Z_BUFc,\
ZLIB_Zowc,\
CUTzlrhCONCAT,\
dynFEW_RECORDS 01000,\
dynthRECORDS 01000,\
duaymNOTNULL 22004,\
dowuludvo 22003,\
!dowys 01000,\
dziOTHERrm,\
gmd2COLLATIONS,\
?pnzh,\
REVOKE_GRANTS,\
gmd3COLLATIONS,\
gmdNCOLLATIONS,\
zosnaSTRUCT,\
yyns,\
wertSSL_PARAMS,\
?wysnjwwmqtp,\
dqkRESOLVED,\
mwweUNTIL_COND,\
toSKIPwe,\
UNTIL_CONDrt,\
ltsqssc ,\
ltsqsCATALOG ,\
?dQC_RESIZE,\
mwFTnu,\
yysqne,\
dHOSTNAME_WONT_WORK,\
yySTORAGEpt ,\
dpgyb,\
txUPDATABLEe,\
qjpj,\
ujvhxo,\
DUPLICATEDzljyt,\
yslzl 22007,\
?ynMUCHmrylCOLS,\
bufze,\
zcPS,\
GET_ERRMSG,\
GETyhERRMSG,\
yyTIME_ZONE,\
dbyl,\
bnjxv,\
dmfunOVERFLOWED,\
CONFLICTING_DECLARATIONS,\
xifvxoq 2F003,\
ximgqd ,\
xiplaqc ,\
xipnqh,\
xixtqh,\
xiLILABELtn ,\
xiLABEL_REDEFINE ,\
xiLABELtn ,\
xiUNINITzn 01000,\
xiBADSELECT 0A000,\
xiBADRETURN ,\
xiBADSTATEMENT 0A000,\
zeipgrt ,\
zeipgTRANSLATED ,\
vnsl 70100,\
xilfudARGS ,\
xiCONDtn ,\
xiNORETURN ,\
xiNORETURNEND 2F005,\
ximwouvn ,\
ximwouwx ,\
xioutn ,\
xioumguh 24000,\
xiouauh 24000,\
xiUNDECLAREDzn ,\
xilfudFETCH_ARGS,\
xiFETCHfow 02000,\
xipouo ,\
xipozn ,\
xipoCOND ,\
xipoCURS ,\
xigmh,\
xiSUBSELECT_NYI 0A000,\
xramfjSF_ORyq 0A000,\
xiVARCONDmcCURSHNDLR ,\
xioumcrm ,\
xiCASEaqv 20000,\
qwynmzqm,\
qwmwro,\
qwEOFjnx,\
qwcjup,\
qwEOFjyyup,\
zsfqe,\
?FRMyyyt,\
luc,\
NONUPDATEABLEnu,\
?zswxDERIVEDzd,\
zswxno,\
zswxzo,\
zswxTMPTABLE,\
zslsy,\
dzsMERGE,\
dzszysq,\
zsb,\
xifpnxi,\
?xiGOTOjHNDLR,\
yqmgqd,\
yqplaqc,\
yqufzsORyge,\
yqgngwq,\
yqfxywqjyq,\
fozqsqk,\
DIVISION_BY_ZERO 22012,\
yslzlqsqk,\
ruzlqsyt 22007,\
zsNONUPDnl,\
zsnlqh,\
PROCACCESSpec ,\
RELAYiqg,\
?PASSWDsv,\
yyyfna,\
IOpviscvp,\
navlPROHIBITED,\
FSEEKqg,\
navlFATALpv,\
ijzf,\
ivlyypv,\
RELAYisf,\
fBINARYtd,\
RESERVEDyb,\
?WSASqh,\
?DIFF_GROUPS_PROC,\
?frhqsPROC,\
?ukzxPROC,\
?tdPROHIBIT_CHANGINGud,\
?fqmMAPPING,\
?lMAGIC,\
PSthuo,\
squw0,\
zsCHECKSUM,\
zsMULTIUPDATE,\
zsfshqksy,\
zspdMERGEzs,\
nfzh,\
XAER_NOTA XAE04,\
XAER_INVAL XAE05,\
XAER_RMFAIL XAE07,\
XAER_OUTSIDE XAE09,\
XAER_RMERR XAE03,\
XA_RBROLLBACK XA100,\
tyPROCrg ,\
PROCmrrgqg,\
PROCmrREVOKEqg,\
owynte 22001,\
ximwSQLSTATE ,\
STARTUP,\
szFROM_FIXEDxeROWSymzn,\
goqzhzxrg ,\
lzlqsyt,\
eDEFnh,\
xiporm ,\
xiaznARG ,\
xifRETSET 0A000,\
goqreuc 22003,\
?qhwpBREAKna,\
nazawp,\
naoqwpNEED_SUPER,\
?EXECxrzxuhou,\
xrHASfuhou,\
nyamfjSF_ORyq,\
fozqszsqk,\
xifvw,\
ynmzSCALE ,\
ynmzPRECISION ,\
M_BIGGER_THAN_D ,\
ltbudyce,\
CONNECTymqtowxh,\
vnufqtowxh,\
qtowxhpmqc,\
qtowxvbgoq,\
qtowxvb,\
?goqFEDERATEDe,\
yqjlwu,\
STACK_OVERRUN_NEED_MORE,\
ynteBODY ,\
dgpnozKEYCACHE,\
ynmzDISPLAYWIDTH ,\
XAER_DUPID XAE08,\
oxraum 22008,\
gzezgejSF_ORyq,\
zsPREVENTze,\
PSfvw,\
xigxbAUTOCOMMIT,\
?tfpb,\
zsFRMfzh,\
zsOTHERzh,\
fxyzh,\
FORBIDwung,\
wqsnwa2 23000,\
fwawq2 23000,\
ximwznSHADOW ,\
yqfpb,\
OLDqmqu,\
xivwsx,\
?xiPROCeon,\
xilts ,\
eNEEDS_UPGRADE,\
xifmd ,\
tlPREPAREDxropREACHED ,\
zsvx,\
txriqkzg ,\
egrlSPKEYS,\
fTRIGGERSufycwu,\
REMOVED_SPACES,\
mtvpqh,\
USERNAME,\
HOSTNAME,\
lxvsv,\
txINSERTABLEe,\
ADMINlMRGe,\
ynHIGH_LEVELudNESTINGqswx,\
tsBECOMESpr,\
AMBIGUOUSqkTERM,\
qtwyqd,\
qtwypmqc,\
ruHAoquj,\
uywjzmc,\
uylzmc,\
uyMAXVALUEc,\
?uyxwc,\
?uySUBPART_MIXc,\
uylfuwc,\
uylfSUBPARTc,\
lEXPRjuyqzc,\
?fCONST_EXPRjvoORsyc,\
qkaqvuwc,\
?syudqlugjHASHc,\
rzuysec,\
uyqzamfc,\
uztrmxpac,\
voaINCREASINGc,\
rzytudFUNCTIONSc,\
tqDEF_CONSTjsyuwc,\
uypuc,\
MIXrmc,\
uyapac,\
ynthuzc,\
xwc,\
goqrmqm,\
BLOBqkjuwqzc,\
yxsqNEED_ALLqljPF,\
fPARTSc,\
uyMGMTuftz,\
qtsqufPARTITIONED,\
pnuytxEXISTENT,\
pnLASTuy,\
COALESCEugufHASHuy,\
REORG_HASHugufwtf,\
REORGfuoc,\
ugufvosyuy,\
ADDuySUBPARTc,\
ADDuyfNEWuy,\
COALESCEuyfuy,\
REORGuyaqc,\
wttsuy,\
fnac,\
CONSECUTIVE_REORGuz,\
REORG_OUTSIDEvo,\
uyraqi,\
?uwSTATEc,\
LIMITEDuwvo,\
vesnaLOADED,\
lzl,\
fuyqsGIVENzl,\
qnujugONCE,\
oqqnqh,\
pnqnqh,\
yemrEXTENDc,\
lxeub,\
xeumc,\
mhqnqh,\
nawqtdqh,\
?nawqleDEF,\
?nawqRBRymSBR,\
pwmgqd,\
?pwxtqh,\
pwplaqc,\
?pwgmh,\
?pwpnqh,\
pwsmaPOSITIVE_ORynmz,\
pwENDSmySTARTS,\
pwEXEC_TIMEjTHE_PAST,\
?pwuheqh,\
?pwNEITHER_M_EXPR_NOR_M_AT,\
?nroppmtkoo,\
?nfszFROMe,\
?pwnfpd,\
?pwCOMPILEc,\
pwwtts,\
?pwowynte,\
pnscqr,\
dpgybzxVER,\
?gzztbie,\
gtbie,\
qtppsqOLDzd 23000,\
nroppmtkPLEASEze,\
?ygevhyauludRBR,\
xuravhyanaqu,\
?NDBgyanaqu,\
uyfyh,\
uyCONST_DOMAINc,\
uyrasnamf,\
?DDLiczd,\
uajzmLESS_THAN,\
luyts,\
gngTX_CHARACTERISTICS 25001,\
popuAUTOINCREMENT_CASE,\
?pwMODIFY_QUEUEc,\
pwxbznc,\
uyMERGEc,\
?gACTIVATEi,\
?RBRamu,\
BASE64_DECODEc,\
pwvwFORBIDDEN,\
?EVENTS_DBc,\
ugINTEGERSmf,\
UNSUPORTEDipt,\
mwixo,\
gRENAMEie,\
lPARAMCOUNTymttFCT ,\
luqymttFCT ,\
luqymxuFCT ,\
ttFCTtsnt,\
popuzxsqts 23000,\
navlEMFILE,\
pwnfoqjTHE_PAST,\
pwnfmhjTHE_PAST,\
?xgINCIDENT,\
fuyqsGIVENzlSILENT,\
nazaxo,\
naFATALc,\
?xgRELAYivpqi,\
?xgRELAYizzqi,\
?xgoqpwqi,\
?xgtjCOMqi,\
natdIMPOSSIBLE,\
zsforCTX,\
zsborCTX,\
?SRborCTX,\
yqooqm,\
yqforCTX,\
yqborCTX,\
pwborCTX,\
yqguhe,\
?goqSROUTINE,\
?NEVERzg,\
fquDESCRIPTIONpwmynaxo,\
weonpw,\
?szowbnuzd,\
ivlfqm,\
XA_RBTIMEOUT XA106,\
XA_RBDEADLOCK XA102,\
NEED_REPREPARE,\
?DELAYEDaxz,\
!dfoitm,\
!dujrt,\
vepdBUILTIN,\
!dveBUSY,\
zosnvr,\
dptyowm,\
?xgrpqi,\
werpzluludvo,\
NDBwgwuc,\
ohFNutc,\
EXCEPTIONSzzc,\
ynteenx,\
ynteqknx,\
qzINEXISTENTtsnt ,\
DATABASEts,\
ets,\
uyts,\
xwts,\
yhts,\
RENAMEDts,\
ynthoeTRXS,\
!dtxASCII_SEPARATORarw,\
DEBUG_SYNCyk,\
DEBUG_SYNC_HITsx,\
poxdxb ,\
xdd 01000,\
xdaqv 02000,\
xdpz,\
RESIGNALzymbrm 0K000,\
xdmwofyt,\
!dCOND_ITEMys,\
COND_ITEMynte,\
yyLOCALE,\
werswyIDS,\
?vnnepj,\
wttsuyqk,\
uynusyc,\
lytnuzlc,\
ynthuyqzqlc,\
MAXVALUEjzmj,\
ynthzmc,\
wqSINGLEuyqkc,\
qkytamfASuyqk,\
uyqlynte,\
nawqptmixrpt,\
nawqtpmixrpt,\
nazamixrpt,\
nawqINJECTIONmixrpt,\
naxrtpmiwqpt,\
nawqINJECTIONmixrtp,\
natqENGINESmiSELFtdpt,\
nazasx,\
?UNUSED4,\
nazayce,\
nazamtnv,\
nazayu,\
nazayczo,\
nazaycra,\
nazaNONTRANSmcTRANS,\
MESSAGEmixo,\
?xgolqh,\
wegoqol,\
INSIDEyovhyanaqu,\
vbsv,\
dpgybfREPLACEMENT,\
ltteSTRUCTURE,\
lPERFSCHEMA_USAGE,\
dI_Sxfe,\
INSIDEyovhyanaDIRECT,\
xuravhyanaDIRECT,\
xjtrrnGEOMnr ,\
yntescnx,\
tbABORTED,\
owuludvo 22003,\
?lSPVARytjsx,\
nazatqENGINESmiSELFtdpt,\
nazaMIXEDxo,\
INSIDEyovhyaxliBIN,\
xuravhyaxliBIN,\
qhvpFROM_PARqm,\
zmsnaINTytc,\
mapefvac 28000,\
?xbvamqve,\
?rgvezhqd,\
TRUNCATEruqr ,\
vesnPERMANENT,\
werpzluludvoMIN,\
werpzluludvotl,\
xrneFULL,\
MULTIzesqoh,\
eNEEDS_REBUILD,\
!dujBELOWsx,\
scnuynte,\
cjyrBODY,\
cjyyyrBODY,\
scon,\
UNDOvuynmz,\
nazashrswx,\
nazashwxze,\
nazawdwx,\
nazaoqrswx,\
nazaoqwdwx,\
nazazers,\
vefUNINSTALL,\
vefsi,\
nazazzmtwx,\
nazaoqwxmt,\
nazashTWO_KEYS,\
ejqrnl,\
zcpt,\
nazamtaFIRST,\
nfszFROMeV2,\
xhDELAYzluludvo,\
ugFDmiRBR_EVENTSmfjnaxo,\
uyqaphuj,\
uyqauwe,\
uyqayge,\
uyINSTEADudxw,\
yyuy,\
ydphtm,\
wqplatkuy,\
nanexeGREATER_THANtl,\
dscaAPPLICABLE,\
uyqaqtsq,\
?fxysqzl,\
wrseowynte,\
?NETWORKvppwCHECKSUMqi,\
?navppwCHECKSUMqi,\
naxrnexeGREATER_THANtl,\
gzeejoqewx,\
uynouftz,\
wqplatkGIVENuyxb,\
?fxyuy~zd,\
ngwrsewhqi,\
zuaoawmzxCREATEDyge,\
zuaoawmzxDROPPEDyge,\
MTAqjsnaxz,\
MTA_UPDATED_DBS_GREATERtl,\
MTAgPARALLEL,\
MTArzow,\
qyaxzzxPARTITIONING,\
ovbofub 35000,\
INSECURE_PLAIN_TEXT,\
INSECUREngxh,\
qtppsqzxnnse 23000,\
qtppsqzynnse 23000,\
SQLTHREADzxwwwe,\
eHASfFT,\
zoaxcjSF_ORyr,\
zoaxcjyo,\
?ktwsnajktwsy,\
?gngktwjyo,\
xbxonfINVOKEra,\
ktwgmxAUTOMATIC_IFktwsysntxua,\
?SKIPPING_LOGGEDyo,\
tfkxbSPECIFICATION,\
tfkxbENCODING,\
tfkSPECIFICATION,\
GNO_EXHAUSTED,\
mwwemrvg,\
mrvgwjktpaue,\
gDO_IMPLICITnyjTRXzvktwsnxb,\
ktpufwjENFORCEkojuf,\
?ktpwjna,\
gxbktwymkzvktpsnue,\
gxbktwymmkzvktpsnuf,\
gxbktwsyymtxuazvktpsnue,\
?qvkpwzvktpsnue~zd,\
kzatxTRANSACTIONALe,\
kzaoqwx,\
?kzaoqpnygejyo,\
ktpCANugngONE_STEP_AT_A_TIME,\
xhHASvmwirk,\
gxbktwzvOWNINGk,\
yyqequ,\
gEXECUTEjvpugyo 25006,\
ynteeuynx,\
weog,\
sgFTsx,\
sgfFTyge,\
sgFTlDOCIDnu,\
sgFTlDOCIDsc,\
sgONLINEiynmz,\
yymhme,\
yymhtb,\
MTAngxhgRUNzxGAPS,\
MTAvvqi,\
MTA_RESET_WORKERS,\
nroppmtkooV2,\
weSILENT_RETRYyo,\
DISCARDqrnmws,\
ewutn,\
ejycye,\
IOvpc,\
IOzzc,\
yeto,\
yeqd,\
yeDISCARDED,\
INTERNALc,\
sgrxc,\
sgscon,\
bYEARnusv,\
aVALIDva,\
trngva,\
qrfscnn,\
qrfscur,\
qrqgADDyc,\
qrnfuhur,\
qrsauj,\
qrpots,\
vaqu,\
qrnunfpn,\
qrnunfpnnn,\
qrnuaua,\
posc,\
qrnunfng,\
qrnunfngnn,\
?UNUSED5,\
tfun,\
vpugtp,\
ktwytUNDEFINEDk,\
zoaxcjxi,\
?gxbkvmzvktpsnue,\
gxbkvmzvkqbsnapr,\
gxbkvmzvOWNEDrksnapr,\
kvmWASnh,\
kqbWASnh,\
naxrtpmifREPLyd,\
mhuiaxz 0A000,\
mhuiaxzvs 0A000,\
mhuiaxzvsCOPY,\
mhuiaxzvsuy,\
mhuiaxzvsqrRENAME,\
mhuiaxzvsnuyt,\
mhuiaxzvsqrnl,\
?UNUSED6,\
mhuiaxzvsNOPK,\
mhuiaxzvsmt,\
mhuiaxzvsHIDDEN_FTS,\
mhuiaxzvsngFTS,\
mhuiaxzvsFTS,\
?xlweSKIP_COUNTERaxcjktp,\
poyyjsc 23000,\
IDENT_CAUSESyntevb,\
mhuiaxzvsaua,\
trngvaLOGIN,\
wqjluy,\
MTApwBIGGER_PENDING_JOBSxetl,\
?sgfFT_USESuu,\
naLOGICAL_CORRUPTION,\
dvlijzf,\
dvlisnmb,\
mrsboh,\
!dufBLOCKHOLEjRBR,\
weCMsfwh,\
weAMsfwh,\
mapengzhc 28000,\
sgvpug,\
xswexlyjyk,\
xsweIOyjyk,\
eon,\
ygqmzzqi,\
sgFT_AUXaHEX_ID,\
OLD_TEMPORALS_UPGRADED,\
sgFORCEDvv,\
AESbIV,\
venfmxUNINSTALLED,\
kzanaSPLITTABLExomiASSIGNEDk,\
weHAS_MORErkTHANxh,\
tosq,\
!dNAMED_PIPEmaEVERYONE,\
@3000,\
qmon,\
cufxh,\
?rzc,\
STORAGEptaLOADED,\
GET_STACKEDovzymbrm 0Z002,\
dLEGACYybCONVERTED,\
nazaqyve,\
nfDISCARDyhe,\
qrDEPTHpx,\
nroppmtkPLEASEzeV2,\
dyrpmrnCREATED,\
wayqplaqc,\
qeaxz,\
bqkxe,\
toHAoquj,\
ptuludMEMORY,\
vaEXPIREmkzh,\
wexlyjtrxs,\
fFT_MATERIALIZEDxx,\
sgUNDOiFULL,\
bmnqsLOGARITHM 2201E,\
weniIOyjtrxs,\
duhygydtrmxZERO,\
dugxhiqmfPOS,\
vnyk,\
txROwxpiTIMER,\
posypu,\
?xltpfEFFECT,\
mdukqsUNION,\
mduktxAGGvn,\
weWORKER_STOPPED_PREVIOUS_THDc,\
?DONT_SUPPORTwePRESERVEnyuk,\
wyOFFLINEtp,\
GISphSRIDS,\
GISzcmn,\
GISyyc,\
GISyypz,\
GISbow 22023,\
nbreprINPUTpz,\
nbreCENTROIDpz,\
nbreOVERLAYbINPUTpz,\
nbreTURNsepz,\
nbreSELF_INTERSECTION_POINTpz,\
nbreyypz,\
xqmwALLOCc,\
xqDOMAINc,\
xqsvc,\
xqbmn,\
xquludvoc,\
xqumc,\
xqvoc,\
xqUNDERFLOWc,\
xqLOGICc,\
xqRUNTIMEc,\
xqyypz,\
GISowlENDIANESS,\
ngxhvasv,\
zhtblts ,\
zhtbDEADLOCK,\
wdINACCESSIBLE_ROWS,\
mhuiaxzvsGIS,\
ruzhzn ,\
ktpue,\
?zcBYwgyj,\
sayt,\
qkjukawx,\
mdjukawx,\
bwrWILDeqpPATTERN,\
tvOKunynst 08S01,\
bspow,\
brdtoMEMBER,\
brdlyt,\
brdUNSPECIFIED,\
DIMENSIONzc,\
weniplaqc,\
?xgtqCHANNELSrqPORT,\
wenitsbORynte,\
weNEWnilwh,\
?xgnipd,\
wetqCHANNELS_CMD,\
wetlCHANNELSpx,\
wenitrxs,\
weniaws,\
weniWASws,\
weniWASaws,\
wenixlyjtrxs,\
wenixlSKIP_COUNTER,\
lqkzxrhV2,\
MIXudrhqzmiqlV2,\
dpgSYSVARze,\
dpgSQLMODE,\
nfiuxpnDATABASEzxk,\
rhwgog,\
rhwgws,\
rhwgmlsfc,\
rhwgxsmlyjyk,\
rhwgnzLAYERxac,\
rhwgnzLAYER_JOINc,\
myDMLzkc,\
vhzozyRBR,\
RUN_HOOKc,\
yowmpqny 40000,\
rcnurasnamf,\
zcmhINPLACEufztnu,\
lqrujqsrcnu,\
txozzlqsrcnu,\
zcACTIONufrcnu,\
rcnutxPRIOR,\
pfBYrcnu,\
rcnuREFmrINC,\
qjamu,\
gxbktp,\
gzfmrvgzxktpue,\
?gwfmkzxmrvg,\
?gwfmkzxktpuf,\
?gwfkzxktpue,\
gENFORCEkojzxONGOINGkVIOLATING_TX,\
ENFORCEkojdzxONGOINGkVIOLATING_TX,\
ACCOUNT_HAS_BEENtc,\
lyets ,\
yesnapr,\
lqmts,\
nbrerzTURNSpz,\
dOPTIMIZER_HINTybc,\
dmwtlEXECUTION_TIME,\
dzctlEXECUTION_TIME,\
dCONFLICTING_HINT,\
dyyQBts,\
UNRESOLVED_HINTts,\
dufMODIFYINGkqbe,\
PLUGGABLE_PROTOCOLnwaxz,\
LOCKINGwzlts ,\
LOCKINGwzDEADLOCK,\
LOCKINGwzyk,\
GIStlPOINTSjreOVERFLOWED,\
xltpMERGED,\
?VTOKENveTOKENtn,\
?VTOKENveTOKENaqv,\
gxbzozvOWNINGk,\
weniuiamf,\
bspTEXT 22032,\
bspTEXTjuo 22032,\
bspBINARYow,\
bspvb ,\
bspnk 22032,\
bspnkjra 22032,\
bytqssp 22032,\
bCASTymsp 22032,\
bspvbnk ,\
bspvbWILDCARD ,\
spzlynmz 22032,\
spsqynmz 22032,\
spzgASsq ,\
spVACUOUSvb ,\
spmwONE_OR_ALL_ARG ,\
NUMERICspzluludvo 22003,\
bspzlqsCAST 22018,\
spDOCUMENTynDEEP 22032,\
spDOCUMENTuasq 22032,\
wwTRANSPORTwi,\
fwwTRANSPORTS_CONFIGURED,\
pjSTORAGEpt,\
zhplaqc,\
zhmgqd,\
mpAPI_ABORT,\
bspvbARRAY_CELL ,\
BUFPOOL_RESIZE_INPROGRESS,\
qjpjSEE_DOC,\
wyISNTmu,\
xaWAS_KILLED,\
CAPACITYpx,\
CAPACITYpxjvoOPTIMIZER,\
?eNEEDS_UPGuw,\
gWAITqsqbkxbWHILE_OWNING_Ak,\
nfADDqtBASEnrzt,\
nfoqztscok,\
cufMODIFYINGkqbe,\
tbREFUSED_BYpt,\
zcmhONLINEufztnu,\
tjsqwoaxzBY_SE,\
?tjsqwocBY_SE,\
tjsqwonaqh,\
tjsqwoSE_UNAVAILABLE,\
yenfENCRYPT,\
bpsuj,\
nfFINDsqjsr,\
CAPACITYpxjuu,\
zcmhpsINPLACE,\
sryusrwzc,\
zhnuOLDsv,\
gRESETxh,\
rhwgtlrhxe,\
nfADDqtBASEnrxu,\
ewa,\
?uyptpgqse,\
?dziGEOMFROMWKBymxbSRID_ZERO 01000,\
?dziGEOMFROMWKBymxbSRID 01000,\
XA_RETRY,\
srAWSyuAWS_KMSc,\
nazaXA,\
yuc,\
srMIGRATIONqi,\
srmapec ,\
srMIGRATION_STATUS,\
?veqhymuhyd,\
?veqhymuhe,\
?mpifsrveINSTALLED,\
?mpipsvaHASaBEENxb,\
?mpiCOULDaoqAESsq,\
?mpipsvanfmxFETCHED,\
?mpispFILTERINGaENABLED,\
?mpiyuskvj,\
?mpiSUPERvjwi,\
?COULDaREINITIALIZEmpiqq,\
?mpiyubmnyt,\
?mpiyubmnop,\
?mpiHASaBEEN_INSTALLED,\
?mpiyuvpbtlARRAYsvARGyt,\
mpiyuvpbtlARRAYsvARGzl,\
?mpispqpuvc,\
?mpispqptsnfmxpr,\
?mpispzhtsnfmxpr,\
?mpispqpplaqd,\
?mpizhFIRSTnjtrmxALPHANUMERIC,\
?mpizhtsbnj,\
?mpirqtsbnj,\
!OBSOLETEdpgMAXDBxltpqsyl,\
?XAwgqq,\
?guhci,\
?riufyljDST,\
?gxnwyNAMED_PIPE,\
zzxbpysx,\
?pgTLSzrxa57,\
?dpgTLSzr57,\
?dltteSTRUCTURE,\
AESbKDFts,\
AESbKDF_ITERATIONS,\
!dAESsqxe,\
AESbKDFujxe,\
@3500,\
UNSUPPORT_COMPRESSEDyhe,\
ACLuiqh,\
zcscme,\
fxyDB 42Y07,\
ynmzENUM,\
yntexbENUMzl,\
bDDuc,\
UPDATING_DDe,\
bDDucID,\
bDDucts,\
yetozxts,\
yntewpnx,\
xiszqh,\
bBITWISE_OPERANDSxe,\
bBITWISEmdOPERANDSxe,\
dzcHINT,\
ywreyt 22S01,\
xmutc SR002,\
xmPROJupto SR003,\
dxmaqv 01000,\
xmaCARTESIAN 22S00,\
xmaCARTESIAN_UNDEFINED SR001,\
PKscgmxINVISIBLE,\
yyAUTHID,\
qhwlrg,\
uhwlyd,\
qhozROLES,\
ocfSCHEME,\
ocfSCHEMEwz,\
ocgsz,\
wlaGRANTED,\
qhREVOKEwl,\
RENAMEwl,\
ocgACQUIREwzrv,\
ocgSATISFY_DEPENDENCY,\
ocszgREGISTERwzrv,\
ocszgINITIALIZE,\
ocyzaLOADED,\
ocyzgDEINITIALIZE,\
ocgRELEASEwz,\
ocyzgUNREGISTERwz,\
ocgyz,\
dyzTHEavd,\
obesa,\
obMANIPULATEwqqh,\
ocyzppjrh,\
gxbkvmDUE_SETS_CONSTRAINTS,\
nftbzhMANAGEMENT_CACHES,\
xmaqv SR001,\
zoavd,\
snvnbno,\
yvymxtxp,\
fycwuma,\
fycyema,\
fycema,\
fycemaqsDICTIONARYe,\
fycemaqsyce,\
fycemaqse,\
bujsq 22023,\
bujzl 22023,\
bujsqzlPAIR 22023,\
bujxnnj 22023,\
bujENDnj 22023,\
bujCHARACTERS 22023,\
ppujsq 22023,\
dxmaqvAXISuk 01000,\
fmaymttFCT,\
RESETxhymzluludvo,\
UNRESOLVEDetb,\
ppetb,\
nazaSKIPtc,\
nazaNOWAIT,\
tbNOWAIT,\
CTEvxwjUNION,\
CTEvxwjNONRECURSIVE_FIRST,\
CTEvxFORBIDS_AGGREGATION,\
CTEvxFORBIDDEN_JOINuk,\
CTEvxwjSINGLEvz,\
yaTMPpt,\
zwfxyzw,\
zwCIRCULARITYjzwGRAPH,\
zwfnnPARTITIONING,\
zwfINHERITqx,\
zwfREDEFINEukBY,\
zwqxxnru,\
zwqxENDru,\
zwqxru,\
zwvoqxukyt,\
zwvoqxTEMPORALyt,\
zwvoqxNUMERICyt,\
zwvoBOUNDaCONSTANT,\
zwppts,\
zwruukBY,\
zwbzwqzzf,\
zwbzwqzALIASzf,\
zwtuzwqzzfjzwSPEC,\
zwROWSsmzf,\
zwfrhukzd,\
zwqesp,\
zwraIGNORESqx,\
WL9236_NOWzd,\
bfudARGS,\
qkjriarhBY,\
ynteyenx,\
ptgpne,\
ptgpntoe,\
yepoFILENAME,\
DBpnRMDIR2,\
IMPfqoMATCHED,\
IMPwuplaqc,\
IMPemgqd,\
IMPryMYSQLDzr,\
IMPryDDzr,\
IMPrySDIzr,\
dbHINT,\
znplaqc,\
LONGITUDEuludvo 22S02,\
suuludvo 22S03,\
arwqsGEOGRAPHICxm 22S00,\
ruvjLEVEL,\
fyczsma,\
obqpFLABBERGASTED,\
uwEXPRynte,\
yupnDYNAMICALLY_REGISTERED,\
yvymxtnuxp,\
yvymzenuxp,\
yvympnnuxp,\
yvymBUILD_HISTOGRAM,\
tgwl,\
toyeqm,\
vcugmapec ,\
?CMD_NEED_SUPER,\
vbjDATADIR,\
nqDDLjPROGRESS,\
nqynthoeCLONES,\
mlipwzkc,\
CTEtlvwDEPTH,\
aHINT_UPDATABLEzo,\
CREDENTIALS_CONTRADICTymHISTORY,\
zuvaHISTORY_CLAUSES_VOID,\
npplaSUPPORT,\
I_Sxfye,\
yepttn,\
lSRIDqsnu,\
nfmhSRID_DUEymsc,\
dnauxUPDATESpj,\
?dnaV1wqEVENTSpj,\
dnauxUPDATES_SUGGESTSuxIMAGES,\
COULDaAPPLYspDIFF,\
oospDIFF,\
wkrhqd,\
wkrhaqd,\
bVCPU_ID,\
bVCPUvo,\
byjPRIORITY,\
pkui,\
wkrhBUSY,\
wkrhpj,\
qjzc,\
mort,\
byjID,\
wkrhBINDqh,\
bzfudFORCEuj,\
rhwgnwqi,\
SDIuiqh,\
tospezl 22035,\
lspezl 2203F,\
TFtrrnALIAS ,\
TF_FORBIDDEN_JOINyt,\
JTzluludvo 22003,\
JTtltuvb ,\
vaEXPIRATIONaxzBYmqMETHOD,\
brdCRSaTOP_LEVEL,\
mwuacart 23000,\
!dUSELESSxjsc,\
DISK_FULL_NOWAIT,\
utcjDIGEST_FN,\
UNDISCLOSEDutcjDIGEST_FN,\
wuDIRqd,\
wuDIRto,\
wuDIRoqqh,\
wuDIRyy,\
ugrwqsSRID_0mi4326 22S00,\
?naEXPIREiDAYSmiSECSzgTOGETHER,\
wbncum,\
wbrumn,\
wbscOUTOFBOUNDSc,\
wbINTERNALc,\
wbRULEyb,\
wbmwESCAPE_SEQUENCE,\
wbUNIMPLEMENTED,\
wbMISMATCHED_PAREN,\
wbmwsm,\
wbtlLT_MIN,\
wbbBACK_REF,\
wbLOOK_BEHINDsx,\
wbtoCLOSE_BRACKET,\
wbbvo,\
wbSTACKum,\
wbTIMEul,\
wbPATTERNynmz,\
gxbciwz,\
prPIPELINEqsciwz,\
obqpDIAGNOSTICS,\
arwqsCARTESIANxm 22S00,\
arwqsPROJECTEDxm 22S00,\
NONPOSITIVE_RADIUS 22003,\
RESTARTwyqh,\
xmtotgmo SR006,\
xmtqmoDEFINITIONS SR006,\
xmtsgmxprOR_WHITESPACE SR006,\
xmORGANIZATIONgmxprOR_WHITESPACE SR006,\
xmIDmgqd SR004,\
dxmIDmgqd 01S00,\
gMODIFY_SRID_0 SR000,\
dRESERVED_SRIDvo 01S01,\
gMODIFYxmzgBYnu SR005,\
xmbnjjmo SR006,\
xmmoxvynte SR006,\
pgUTF8_ALIAS,\
pgNATIONAL,\
bozUTF8MB4ns,\
yvymCOLLECTiSTATUS,\
RESERVEDyets,\
yvymxbuj,\
wePOSSIBLY_DIVERGEDmcDDL,\
xmaGEOGRAPHIC 22S00,\
POLYGONynst 22023,\
xjyxsc,\
scytaxzqsxjsc,\
qrnfpnur,\
reuoLONGITUDEuludvo 22S02,\
reuosuuludvo 22S03,\
qrnfzfztnu,\
qrfnuur,\
gxbcSUPPRESSIONsy,\
xmGEOGCSbAXES SR002,\
xmbSEMI_MAJOR_AXIS SR002,\
xmbINVERSE_FLATTENING SR002,\
xmbANGULAR_UNIT SR002,\
xmbPRIME_MERIDIAN SR002,\
ypxhxmaxz 22S00,\
ypyfxmaxz 22S00,\
ypxhxmtoTOWGS84 22S00,\
ypyfxmtoTOWGS84 22S00,\
ygevhyaxanaqu,\
ygevhyarfnaqu,\
wsmlvhyarfnaqu,\
npkzaoqpnygejTRXjSBR,\
?XAgoqMDL_BACKUP,\
ezyPK,\
dowysrbsc 01000,\
dowuludvorbsc 22003,\
rbscufspORrera ,\
rbscREFmrsb,\
nfpnnurbsc,\
rbscvisq,\
rbscufLOB,\
rbscrasnamf,\
qyrbsc,\
xjrbsc,\
lsqnurbsc,\
rbscufqk,\
rcnuNAMEDrasnamf,\
rcnuwqzl,\
rcnuzp,\
pfBYozrczl,\
ozVALrctxPRIOR,\
ozVALrcREFmrINC,\
ozVALrcrasnamf,\
ozVALrcNAMEDrasnamf,\
ozVALrcwqzl,\
ozVALrczp,\
ozAS_VALrc,\
zcACTIONufozVALrc,\
kzamhADDnrzxozEXPRESSION,\
qrnfngpt,\
dpgzhxbEXPR,\
dpgUTF8MB3ns,\
dpgtunxyb,\
qrrynv,\
GR_HOLD_WAITyk,\
GR_HOLD_KILLED,\
GR_HOLD_MEMBER_STATUSc,\
wrpsqhymFETCHsq,\
wrpssqaqv,\
wrpssrbsq,\
wrpsroc,\
wrpsqhymwnLOGS,\
wrpssqqdyw,\
wrpsqhymGENERATEsq,\
wrpsqhymxtsq,\
wrpsqhymREMOVEsq,\
wrpsyvymnguj,\
wrpstjsqvvqh,\
SLOWitprtzvatdymqm,\
rjTRXojamf,\
rjTRXojmy,\
rjTRXojmcufTRX_BEGIN,\
rjTRXojBEGINamf,\
rbscwqzlsnamf,\
wrpsqhymENCRYPT,\
PAGE_TRACKINGaSTARTED,\
PAGE_TRACKINGvoaTRACKED,\
PAGE_TRACKINGnfvl,\
wrpsnfwnnatjsq,\
natjsqvvuludCOMBINATION,\
natjsqwoqgymOPERATEsq,\
natjsqwoqgymwnLOGS,\
natjsqwoqgymREENCRYPTi,\
natjsqwoqgymCLEANUPzdKEYS,\
natjsqwoqgymCLEANUP_AUXsq,\
txBOOLEAN_EXPRqsnlok,\
nunlokREFERENCES_OTHERnu,\
nlokNAMEDrasnamf,\
nlokrasnamf,\
nlokzp,\
nlokwqzl,\
nlokREFERSmrsbnu,\
nlokVIOLATED,\
nlokREFERSyynu,\
nlokaqv,\
nlokpots,\
nloknoziqrREFER_ACTIONnu,\
!dUNENCRYPTEDejENCRYPTED_DB,\
bpsREQUEST,\
nfxbeps,\
nfxbDATABASEps,\
nfxbyeps,\
yenfmxENCRYPTED,\
yenfmxDECRYPTED,\
yeytyy,\
yfyeUNENCRYPTED,\
nfzfpsno,\
btqCLAUSES,\
zczfudrgAS,\
UKNOWNmqID_ORmapeqsrgAS,\
pfBYrbsc,\
veaEARLY,\
sgvyimmxnSUBDIRvb,\
sgvyimmxnyk,\
sgvyimmDIRSb,\
sgvyimmLABELaqv,\
sgvyimmDIRpr,\
sgvyimmfxyDIR,\
sgvyimmDIR_CLASH,\
sgvyimmDIR_PERMISSIONS,\
sgvyimmqmoq,\
sgvyimmmb,\
sgvyimmINACTIVE,\
sgvyimmqh,\
sgvyimmxa,\
xqREGEXc,\
bspyt 22032,\
nfomxv,\
pfBYuyqz,\
dpgFLOATmrsb,\
wrgxsweWHILEtcBACKUP,\
dpgFLOAT_DIGITS,\
dpgFLOAT_UNSIGNED,\
dpgINTEGER_DISPLAY_WIDTH,\
dpgZEROFILL,\
nqDONOR,\
nqPROTOCOL,\
nqDONORzr,\
nqOS,\
nqPLATFORM,\
nqnk,\
nqCONFIG,\
nqSYS_CONFIG,\
nqvetk,\
nqLOOPBACK,\
nqps,\
nqDISK_SPACE,\
nqjPROGRESS,\
nqpk,\
nfrgROLESymmkzh,\
wvptve,\
SECONDvanfmxpr,\
DBmape,\
ovmqIDzxyczhPRIVjtgROLES,\
ovwrkenfuh,\
rejyysvUNIT SU001,\
ovvesic,\
fxayg,\
ovyycub,\
nungxe,\
wbbCAPTURErhts,\
ovSSL_LIBRARYc,\
wvpt,\
wvptDDL,\
saotva,\
tootva,\
otvaawi,\
vanfmxRETAINEDufveng,\
otvanfmxRETAINED,\
uxREVOKESqc,\
nfrgycPRIVymtgwl,\
XAwgqq,\
zcxltp,\
wbbFLAG,\
uxREVOKEmiDBrgBOTHqd,\
UNITaqv SU001,\
bspzlqsqzsc 22018,\
spzluludvoqsqzsc 22003,\
pxMV_KEYS_NUM,\
pxMV_KEYS_SPACE,\
rbscowsnynte 22001,\
lMVIzl,\
dqzscaAPPLICABLE,\
rjwryuc,\
zekvmzxGR,\
riufyljDST,\
etsCAUSESyntevb,\
mpiskvj,\
?mpivaHAS_BEEN_COPIED,\
ovrjwrSTARTEDmrREJOIN,\
SYSVARngpqvn,\
GLOBSTATngpqvn,\
rjwrMESSAGEwzsfqi,\
ngxhlodmenp,\
ngxhlodLEVELnp,\
lodmenp,\
lodLEVELnp,\
ngxhlodmesynp,\
npvjnmzhnfmxmk,\
npvjnmzhplaqc,\
npvjnmzhon,\
npvjnmzhNEEDSwrmlPRIV,\
dovvjaREGISTERED,\
npsryusqb,\
npsryusqytb,\
npsryusqynte,\
npsryusqytynte,\
spwuzkczxDETAILED_REPORT,\
ovyubnkxk,\
ovyubnk,\
ovyubns,\
ovyubEXTENSIONmnyt,\
tqCONSTRAINTSzxwtts,\
okaqv,\
mhokENFORCEMENTaxz,\
ezlCONSTRUCTORtrrnnv,\
ezlCONSTRUCTORnfrnoz,\
npvnqibtxwqqu,\
REQUIREwqqubzl,\
qhymDETERMINE_IFwlsntg,\
qhymFETCHtgwlsy,\
npLOCALqopj ,\
IMPryCFGzr,\
ovOOM,\
ovyubmnymxbnk,\
ovyubRETURNytymxbnk,\
tqINTO_CLAUSES,\
MISPLACED_INTO,\
zhmapeqszhACCOUNT_BLOCKED_BYvatb,\
dpgYEAR_UNSIGNED,\
nqNETWORKun,\
SDIuiqhtovu,\
pfBYnlok,\
rjuiamfGRtrxs,\
dpgspeufcufpr,\
dpgINNER_INTO,\
dpgzmraALWAYSua,\
dpgxlCALCqvROWS,\
dpgqvROWS,\
tospzl 22035,\
tqspzm 22034,\
HOSTNAMEynte,\
?dnppguyPREFIXsq,\
rhwgzhprMSG,\
rhwgzhtgMSG,\
rhwgvasv,\
xxypREJECTED,\
ovrjwrvvENDPOINTqu,\
ovrjwrvvENDPOINTb,\
lzlqsznPLUS_ACTIONABLEuw,\
xoamfmcxnyo,\
qtsqzxATOMICoqwx,\
amfzxxnyo,\
bspmo,\
ptmoaxz,\
bzhmosp,\
sgvypj,\
sgvyARCHIVING_ENABLED,\
MDLuludRESOURCES,\
IMPLICIT_COMPARISONqssp,\
raplaSUPPORTnjxb,\
IMPOSSIBLExvol,\
wuvpug,\
wrASYNCvtktpue,\
wrASYNCvtmrvgue,\
piktpwjASYNCvtue,\
pimrvgwjASYNCvtue,\
bupzf,\
njxbtn,\
dznzlngaxz,\
bTIME_ZONEsm,\
bCAST,\
rraxzYET ,\
?drrEXPERIMENTAL,\
ovfciuuCONFIGURED,\
ovciepj,\
ovcitqqq,\
ovguhci,\
zhwaASpb,\
nfzhwaASpb,\
REGEXubynmz,\
SPVAR_NONINTEGERyt,\
!dzcACLydvp,\
nazaACLevpjDML_DDL,\
xsweMONITOR_IOyjyk,\
STARTINGweMONITOR_IOyj,\
gzfmkymkzxktpauf,\
gCOMBINEmkymkmiAUTOPOSITION,\
ASSIGNrkymmkTRANSACTIONSwjktpuf,\
xlweSKIP_COUNTERzgzxktpuf,\
ziASSIGNrkymmkTRANSACTIONS_AS_LOCAL_ORzj,\
?xbkymANONmiWAIT_UNTILxlTHDmcrk,\
gxbxlmcORmyrkzxmkymk,\
mkymkzjwtASrhts,\
gzfwtzjASrhts,\
rjwrvvniSTILLws,\
sgbmsxezl,\
sgryzxye,\
sgmsxeuludvo,\
nfzfmsxeno,\
wlGRANTEDymITSELF,\
etrrnA_VISIBLEnu,\
sgodqi,\
dASYNC_CONN_FAILOVER_NETWORK_NAMESPACE,\
npINTERACTIONyk,\
bCASTymre 22S01,\
bCAST_POLYGON_RING_DIRECTION 22S04,\
GISphSRIDS_AGGREGATION 22S05,\
RELOADsrqi,\
SDI_GET_KEYSbye,\
ngwrSRClodmexe,\
?dpgTLSzrqsniCLI,\
gzfwtzjASzsngzj,\
mkymkzjwtASzsngzj,\
rjwrzsngzjqgGETzo,\
dADUITitlxemiPRUNE_SECONDS,\
dADUITitlxeCLOSEymwnufxe,\
KERBEROSoqzh,\
siveohnp,\
ovciobFLUSHqh,\
dxlmcMTS_GAPS_GAPaCALCULATED,\
bASSIGNMENTyf ,\
uiamfufGRwv,\
rjwrFAILOVERniSTATUS_PROPAGATION,\
dmpiquUNIXylugzvsp,\
bMFAvexk,\
IDENTIFIED_BYzc,\
bveqswc,\
vewjwc,\
MFA_METHODqd,\
MFA_METHODaqd,\
AUTHENTICATIONvftn,\
vewcDONE,\
bzhqswc,\
zhwcqh,\
MFA_METHODSbuk,\
MFA_METHODS_IDENTICAL,\
bMFA_OPERATIONSqsPASSWORDLESSzh,\
ngwgxhfOPTIONSqskug,\
ngREPxhgpiREQwqquzxkug,\
ngREPxhgpimrvgzxkug,\
ngREPxhgpikugzyPOSITIONS,\
ngREPxhgpimrPOSzyPOSITIONS,\
ngREPxhGRnizxktpauf,\
gzfkugzxktpauf,\
dCpikugzxxhmrPOSbPOS,\
ovSSL_FIPStpc,\
zluludvo,\
qyzxROLLUP,\
wbtowk,\
dwbzioz,\
wbtoqm,\
dpgns,\
oevkUSAGE,\
ovrfCONNsx,\
ovCONNsx,\
mhuiaxzvsnuytsj,\
dSFyutsnt,\
nfvlnazxBACKUPtb,\
ynthWINDOWS,\
MYSQLBACKUPnpMSG,\
nxCONTAINSbxv,\
pcCONTAINSbxv,\
gEXECUTEnwzxASSIGNEDktw,\
XAyge,\
sgtlwqzr,\
?sgsjADDaxztlxe,\
uiamfWHILEvingsnws,\
dpgoxDELIMITER,\
dpgSUPERFLUOUS_DELIMITER,\
nfvcSENSITIVEzp,\
dnfSECURELYvcSENSITIVEzp,\
dyqmgqd,\
IFaqdzcyqqdufphe,\
IFaqdzcyuttFCTtsnt,\
xbvamqvec,\
?REDUCED_DBLWRqmoo,\
?REDUCED_DBLWR_PAGEqv,\
xmbsuudORIGIN SR002,\
xmbLONGITUDEudORIGIN SR002,\
xmzdPROJupPRESENT SR002,\
GIPKnuqd,\
GIPKqhmtnuqd,\
GIPKnumhamf,\
pnPKnuympnGIPK,\
oqwxzxGIPKpkjSBR,\
?ovEXPIRE_LOGS_DAYSrt,\
CTEvxaUNION,\
nwBACKENDqhymFETCH_SECURITY_CTX,\
nwwzBACKENDqh,\
npqmvjqswgnm,\
rhwgFORCE_MEMBERSnwqi,\
dpgIDENT,\
INTERSECT_ALLtlDUPLICATESpx,\
TPvnTHRS_PERrjpyTXN_THRsx,\
mwylqu,\
SHAPE_PRIDICTIONyu,\
xmbHEIGHT SR002,\
xmbSCALING SR002,\
xmbZONE_WIDTH SR002,\
xmbsuPOLAR_STEREznA SR002,\
dpgnpfwuuj,\
eapr,\
efvisq,\
ejSHAREDye,\
scOTHER_THAN_PK,\
szndowUNSORTED,\
ndEXECUTORc,\
ndvqswsfqh,\
ndvqswc,\
ndvqwyc,\
ndvqnzc,\
ndszowqh,\
ndtanuynmzqsLEFTOVERnc,\
ndtaobc,\
ndtaqmCONTAINS_LESS_LINES_THANrsno,\
nduutoENCLOSED_BY,\
nduuwqnctlTOTAL_COLSpx,\
nduuCOPYncxepx,\
nduuywENDudINPUT,\
nduuywwqyi,\
nduuywCHARmcENDING_ENCLOSED_BY,\
nduuywCHARmcuaESCAPE,\
nduuywCHARmcnuyi,\
nduuINCOMPLETE_ESCAPE_SEQUENCE,\
szndowqh,\
szndowlzlqsqk,\
szndowduaymNOTNULL,\
REQUIREevisqnlGENERATEzxGR,\
gngSYSznjvpugtp,\
sgsjADDpnaxztlxe,\
sgsjADDaxztlql,\
gxbvd,\
siobxbuazl,\
siobxbzdzl,\
dpgzhpaCOLLATIONS,\
zhtbOVERLONGts ,\
dfSPACEzrnx,\
VALIDATEvasknhCHARACTERS,\
dpgzxNOTE,\
gRUNnwSERVICES_RECURSIVELY,\
dmpiqpvvtdpj,\
@6000,\
ssob,\
ssobamu,\
ssobzcss,\
ssobnfUNINSTALL,\
xifmhss,\
?qeINTO_ANALYZEaxz 0A000,\
qeINTO_IMPLICITquaxz 0A000,\
qeINTOquaxz 0A000,\
uagmxvdqsvr,\
qeINTOqsoiaxz 0A000,\
sgrxlDROPPED_ENUMsv,\
sgrxlubudINDEXES_ZERO,\
sgrxlubudINDEXESynHIGH,\
sgrxpnnrtmtn,\
sgrxENUMuayito,\
SIMULATED_INJECTIONc,\
dpgDYNAMIC_PRIVjrg,\
ndMULTIvquhqmqh,\
ndMULTIvqvpqmqh,\
ndMERGEbCHUNK,\
ndMERGEaALL_CHUNKS_CONSUMED,\
ndWRITERswsfqh,\
ndWRITERswc,\
ndSORTINGtazz,\
ndSORTINGtaWAIT,\
ndvquhqmqh,\
ndszeHASsjCOLS,\
ndszwk,\
ndszwvpt,\
ndvqc,\
ndvqqmpmqc,\
ndvqCOULDNT_RESOLVErq,\
xnwenibog,\
nfEXECUTEjvi,\
ynthrhBY_MODIFIER_BRANCHES,\
dpgptybfREPLACEMENT,\
QUALIFYzyzwra,\
xzugzxrr,\
SPECIFICmape,\
gxbktwymAUTOMATIC_TAGGEDzvktpsnue,\
ktwTAGktpue,\
hnraNULLABLE,\
hdnrtoaNULLABLE,\
hnrsnpr,\
hnrsnprd,\
hmwzl,\
hoyyypv,\
hoyOOMpv,\
hdoyROUNDING,\
hoyPRECISIONpywu,\
hpyMIN,\
hpytl,\
hdpyMIN_TRUNCATING,\
hdpytlTRUNCATING,\
hREALsnNAN,\
huludvo,\
hoxqu,\
hdys,\
hnfomxv,\
hwkPRINCIPALpv,\
hAWSmqpv,\
hCSVuvpv,\
hnutnpv,\
hnutlpv,\
hnkzc,\
husoyolpv,\
hxvynte,\
hwkPRINCIPAL_BUCKETpv,\
hfqoqv,\
hprqm,\
hppqm,\
hmvwuDEPTHpytl,\
hmvrotn,\
hmvENUMnfomnk,\
hmvENUMtn,\
hmvytnfom,\
hmvqmENDS_UNEXPECTEDLY,\
hmvqmowon,\
hmvbUNION,\
hmvbBLOCKxe,\
hmvbBLOCKvuop,\
hqurofMAGIC_BYTES,\
hmvrotmpv,\
hmvrofwu,\
hmvfCODECjro,\
hmvbtsjwu,\
hmvDECODINGpv,\
hustxUTF8qmENC,\
huswutn,\
huswqrhxepytl,\
husnfLOCATE_OFFSET,\
husytnfom,\
husnfLOCATEwu,\
hsdNUMnrtn,\
hOOM,\
hdsdxfLINES,\
hdsdxfqo,\
hsdqmHASfow,\
hsdfow,\
hsdfqo,\
hdsdzfoznrNAMES,\
husnfvpro,\
hsddGOTpz,\
hmvnfutro,\
husguhqm,\
hynstzlpv,\
hynstwqpv,\
TABLESAMPLE_PERCENTAGE 2202H,\
TABLESAMPLEugufBASEyd,\
?upsculudvo,\
RESULTxesxpx,\
ssobINTERNAL,\
ssobCONCURRENCYsx,\
ssobRUNTIME,\
ssobTIMEZONE,\
ssobKEYWORD,\
ssobxbyczo,\
ssobzcyt,\
ssobol,\
dxixoPARTIALLYqb,\
xrEXECUTIONamfWITHINxiORyqORyu,\
hspuv,\
ptnfmxoz,\
uyPREFIXsqaxz,\
dpgtxSTANDARDsq,\
qrfyxscur,\
mapefPROXYrg,\
mapefPROXY,\
hzhowmaqh,\
ndvqZSTDc,\
nduuc,\
hbspqmquwu,\
hsdspbwu,\
hspqmqudsdwu,\
txSCALARzgASsq,\
ryytAGG,\
owryzxzq,\
pyzqtlDIMENSIONS,\
ymzqol,\
?qfzcscme,\
TPnfpiMTLzxDL,\
rjwroiHANDOFF_BUSY,\
@6400,\
wyOFFLINEtpvs,\
?wyOFFLINEtpzh,\
hzbfowqv,\
hzbqmutpv,\
hzbENCODINGpv,\
hzbqmyttnpv,\
hzbwupv,\
hnuptATTRpv,\
hzbOBJvppv,\
hfSEGMENTSrc,\
hzbqmynst,\
pxtlREGULARxorlsx,\
qeANALYZEspquzraxz 0A000,\
txDML_DYNAMICuq,\
DEPRECATEtxCOMPOSABLEtqpt,\
ndspb,\
ndBLOBynmz,\
fvnPLANqv,\
hCPynthCHANGES,\
hCPaENABLED,\
hCPfzqxt,\
hCPfzktp,\
?hCPtoqotp,\
hCPnyqh,\
hzbbss,\
hzqynthENTRIES,\
nduuywENCLOSED_BYnj,\
CMD_NEED_SUPER_ORoqxjvzyc,\
nort,\
bnojCONTEXT,\
bnoCOMBINATION,\
dREDACTED_PRIVILEGES,\
bOUTERvz,\
LIBRARIESaxz,\
hdSUMMARY,\
hdsdzfozDELIMITERS,\
LIBRARYb,\
nfvcyoISOLATION,\
hmvbvu,\
hbzljzq,\
hdzqLOSSYol,\
hzbTRUNCATIONc,\
hzbPAGE_CHUNKd,\
hzbynthCHUNKS,\
mapeFIREWALL 28000,\
hDECOMPRESSIONpv,\
sobpclmj,\
soALGO_TEMPTABLEaxz,\
sozxnlujaxz,\
sobpctxSIMPLEwxaxz,\
sobpcCTEaxz,\
sobpcGROUPBYaxz,\
sobpczwraaxz,\
sobpcsxaxz,\
sobpcORDERBYaxz,\
sobpcMULTIydaxz,\
sobpcfWHEREofjSUBOBJECT,\
sobpcWHEREofjROOTOBJECT,\
sobpclWHEREquqsSUBOBJECT,\
sobpclqkyt,\
sobpcCONTEXT_PREPAREqh,\
sobpcfspucjROOT,\
sobpcMUSTBEspucqsSINGLETON,\
sobpcMUSTBEspucqstu,\
sobpcfspOBJjARRAYAGG,\
sobpcRELATIONSHIP_RULES_VIOLATED,\
sobpcnuytaxz,\
sobpctxBASEeaxz,\
sobpcezyPKqv,\
sobpcezyPK_PROJECTIONqv,\
sobpcIDsqzgBYaROOTe,\
sobpcIDsqazgBY_ROOTe,\
sobemjqsSINGLETON_OBJ,\
sobemjqstuOBJ,\
sobpcppKEYSaxz,\
sobpcppnuaxz,\
sobpcwterzPROJECTION,\
sobpcnusyaxz,\
sobpcrzeqkjTHEuc,\
sobpcWHERE_USEStxIMMEDIATEur,\
sobpcCOMPOSITEsqzg,\
sobpcALIASazgqswtyd,\
souiaxz 0A000,\
somhORwdaxz,\
sobspDUALITYucUSAGE,\
soywspyt,\
sovisqtrmxPROVIDED,\
soJOINofaSATISFIED,\
soPK_DUPLICATESaIDENTICAL,\
soUNMAPPEDsq,\
sotoshTAG,\
sotovrSUBOBJECT,\
soJOINofVIOLATION,\
sotoETAG,\
soETAGtn,\
sotozl,\
soPK_UPDATESamf,\
sotozeTAG,\
sotopdTAG,\
souashzl,\
soshzlaFIXED,\
souazezl,\
sozezlaFIXED,\
?soqjEDITIONsx,\
sonfmxzgzx,\
soDMLse,\
?sotozlqsAGnu,\
sobBINARYytro,\
ETAGaxz,\
ptmooh,\
qfquaxz,\
qfebuj,\
qfeptaxz,\
qfeptaxk,\
hfqoqvfwwqmPRIV,\
hnrtsto,\
hnrtspp,\
hzbOCI_GENAIqi,\
hzbuxqmutpv,\
soEXPLICITmrsbamf,\
hsdnrtstn,\
hDELTAwutn,\
hDELTAtmvpc,\
hDELTAzcc,\
dACCOUNT_TRIMMED,\
hdoxtquozf,\
hGENCOLc,\
TEMPORALraum 22008,\
hsdnutlpv,\
hEXTRAnvjqm,\
husCOMPLEXol,\
mpipj,\
mpiobspqpuvc,\
mpiqhymuhyd,\
mpiqhymuhe,\
mpiobspqptsnfmxpr,\
mpiobzhtsbnj,\
mpifsrINSTALLED,\
mpiobnfvpva,\
mpiobrqtsbnj,\
mpiobspzhtsnfmxpr,\
mpiobsrIDylzlsnb,\
mpiobyubmnyt,\
mpiobyubmnop,\
mpiABORT,\
mpiCOULDaRELOADqq,\
mpiyubmnua,\
mpitlxeCLOSEymwnufxe,\
mpitlxemiPRUNE_SECONDS_PRECEDENCE,\
mpivaHASaBEENxb,\
mpibepc,\
mpiobqpqhymxteFLDS,\
mpiobqpqhymsfeqsvp,\
mpiobqpqhympdFROMe,\
mpispqpplaqczh,\
hCUSTOMowPLACEMENT_OVERRIDES,\
hmvqoowyttn,\
mpiobbqpABORT,\
mpiobspbqpnfmxzg,\
dmpiqqb,\
sorcmiEXPLICIT_PKSamf,\
tivfobc,\
tivfmgqd ,\
tivfEXPECTS_CASE ,\
tivfEXPECTS_CASEzv ,\
tivftoELSE ,\
tivfONEzvwi ,\
tivftrRETURNmn ,\
tivfbGATEKEEPER ,\
tivftxLITERAL_GATEKEEPER_ARG ,\
tivfpkCONSTRUCT ,\
tivfbnuvz ,\
tivfrynuqj ,\
tivfryTYPES ,\
tivftxDETERMINISTICqz ,\
qrtlydjCASCADE_CHAINpx,\
qrCASCADEyrUPDATINGqrnvaxz,\
gzezgejqrCASCADE,\
dxbOPERATIONSnc,\
soywbzl,\
@6900,\
osyymlzr,\
osmlWORKERopuludvo,\
osmlWORKERopugqsCSA,\
CSAzcUNTIL_COND,\
osmlpwMEMORYsxugqsCSA,\
dosmlpwMEMORYsxuludvo,\
CSAosDELAYEDmlaxz,\
CSAosREQUIREMENTwqqu,\
CSAosREQUIREMENTkug,\
ovnfwfzyna,\
weIDENTITYoh,\
ndvqvbsnDIRECTORY,\
sonuTAGaxzqsxx,\
sozenuTAGaxzqsPK`
