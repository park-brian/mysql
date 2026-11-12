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
export const ERROR_NAME_WORDS = 'ER OBSOLETE INVALID ERROR SUPPORTED TABLE NOT PARTITION BINLOG WARN CANNOT CANT DEPRECATED WRONG COLUMN DEFINITION FAILED COMPONENT REPLICA UNSUPPORTED GTID VALUE TABLESPACE UNKNOWN AUDIT LOG ENCRYPTION INNODB ALLOWED MISSING PASSWORD OPERATION INDEX CHANGE CREATE JSON REPLICATION ENGINE TRANSACTION FUNCTION GENERATED NAME UNSAFE KEY WITH EXISTS SOURCE RANGE TOO MISMATCH USER WINDOW CONSTRAINT DEFAULT UNSTRUCTURED GROUP FILE FUNCTIONAL JDV MODE FORMAT PLUGIN BULK TYPE FOR OPTION SCHEMA SELECT ALTER NO EVENT COMPONENTS FIELD ACCESS CLIENT REGEXP UPDATE FAILURE LH ANONYMOUS VARIABLE INCOMPATIBLE DATA GEOMETRY LANGUAGE SYSTEM CHARACTER FOUND CHANNEL SET UNEXPECTED MULTIPLE FOREIGN KEYRING READ STATEMENT ARGUMENT EXCEEDED IN DENIED DROP ONLY DUPLICATE EXCEPTION SIZE CHECK DISABLED EMPTY MASKING PREVENTS REQUIRES VIEW WITHOUT LONG PRIVILEGE ARCHIVE ILLEGAL SERVICE INCONSISTENT LIMIT FILTER MASTER POLICY REASON ATTRIBUTE AUTO CONVERSION REFERENCED SRS VERSION TO COMPRESSION CONSISTENCY IMPLEMENTED MAX PARSER ROW TABLES THREAD CLONE APPLIER CHARSET LOCK NULL OPEN RUNNING TIMEOUT LENGTH AGGREGATE GRANT RECURSIVE TIMESTAMP UDF RESOURCE ROTATION RPL ALREADY COMMENT EXCEEDS EXIST IGNORED OUT PARQUET READER SERVER STRING SWITCH UNUSED MUST USED ALGORITHM MANDATORY ORDER QUERY RECOVERY REGISTRATION AVRO COMMAND CONNECTION CORRUPT DISABLE EXPLAIN MANY COUNT INFER NON SP WRITE DOES LOAD CLAUSE ERR HEADER OBJECT ON SYNTAX OF POSITION AFTER BAD COLLATION COLUMNS CONDITION DIFFERENT FUNC HANDLER INCREMENT LOGGING PARAMETER PRIMARY REFERENCE SLAVE TRUNCATED WHEN AND USE FIELDS LIST REDO STMT SUBPARTITION AUTOINC CONFLICT CREATION EXECUTED FEATURE METADATA NEXT OVERFLOW PARTIAL ROLLBACK SPATIAL TEMP IS CORRUPTED CURSOR DELETE DEPENDENT DOESNT DUP DURING INCORRECT INSERT MALFORMED RECURSION SECONDARY TEMPORARY TRANSFORM UNABLE VALUES VARIABLES BIG TRG COL COMMUNICATION CONFIGURATION CONVERT DISALLOWED FILTERS MATCH PARAMETERS PATH PURGE REPOSITORY SESSION STATISTICS VALIDATION EXTERNAL NATIVE NUMBER PURGED REQUIRED VECTOR VAR FAIL HAVE INFO INSUFFICIENT PART SAME STOP SUCH AVAILABLE COLLISION FILEGROUP FILES FRAME HEARTBEAT PARSE PERSISTED PROCEDURE RECONNECT REPLICATE SPECIFIED SQL START FK ANNOTATIONS CHECKS COMMIT DECIMAL FPARSER GRP IMPORT INSTALL INSTANT INTERRUPTED NONEXISTING PARENT ROLE SIGNAL TRIGGER UNLOAD VIRTUAL BOOST COMPLETE DA DATETIME EXCHANGE FULLTEXT GROUPING GTIDS INTERVAL LATITUDE OFF PARAM READONLY SETTABLE STORE SUBQUERY AUTOEXTEND CONCURRENT HYPERGRAPH PARTITIONS TERMINATOR IMPLEMENTATION NONPARTITIONED ACTIVE BE BEFORE BUFFER GLOBAL HANDLE IGNORE LOADER LOCKED NESTED PACKET RECORD ROTATE SECURE STORED TARGET UNIQUE AUTH CACHE CARTESIAN CHANGED CHILD CRST CURRENT DEFINED DEFINER ENTRY EXECUTION FORBIDDEN GEOJSON HOST INIT INJECTION INSTALLED LARGE LIBCURL LONGITUDE NET PARSING'

/**
 * `@errno` starts a sequential range; each following line consumes one code.
 * Entry lines contain a packed symbol and an optional SQLSTATE. Symbols begin
 * with an implicit ER_ unless prefixed by !. Lowercase tokens encode words, _
 * separates adjacent raw words and ~ encodes an empty word. The decoder
 * preserves entry order and alias precedence.
 */
export const PACKED_ERROR_TABLE = `@1000
!baHASHCHK
!baNISAMCHK
of
YES
lmwns
lmwf
lmwDB
DBmwnh
DBpknh
!baDBpkuq
DBpkRMDIR
!baluqns
lFINDovREC
lGET_STAT
!balGET_WD
lra
lrcns
nsgox
lpeDIR
!balozWD
CHECKREAD
!baDISK_FULL
utnf 23000
!badtaCLOSE
dtape
dtaRENAME
dtast
nssb
!baFILSORT_ABORT
!baFORMgox
GET_ERRNO
qaHA
nfgox
gFORMns
gKEYFILE
OLD_KEYFILE
rcASyc
OUTOFMEMORY HY001
rttcSORTMEMORY HY001
!bapaEOF
CONspd 08004
rttcRESOURCES
tfzrd 08S01
HANDSHAKEd 08S01
DBACCESSpjd 42000
ojpjd 28000
ofDBd 3D000
mlCOMd 08S01
tfrbd 23000
tfDBd 42000
fnhd 42S01
tffd 42S02
srUNIQd 23000
rwSHUTDOWN 08S01
tfoid 42S22
mboingnr 42000
mbnroi 42000
mbSUMod 42000
mbmjsp 21S01
nkpxIDENT 42000
utFIELDNAME 42S21
utKEYNAME 42000
utzn 23000
mboiSPEC 42000
wqd 42000
prsf 42000
NONUNIQf 42000
cnp 42000
pbPRInf 42000
nksoKEYS 42000
nksonfPARTS 42000
nkpxnf 42000
nfmcsugEXITS 42000
BLOBsbASnf 42000
nkvfFIELDLENGTH 42000
mbqjnf 42000
READY
!baNORMAL_SHUTDOWN
!baGOTxm
SHUTDOWNxr
FORCING_CLOSE 08S01
IPSOCKd 08S01
ofwjmu 42S12
mboiTERMINATORS 42000
BLOBStuofTERMINATED 42000
TEXTFILEgREADABLE
nsnhd
svwe
oewe
mbSUBnf
lREMOVE_ALLtw 42000
lpkoiORnf 42000
uwwe
omfsb
ofwjqw
KILLpjd
ofqvsb
nkvfoz
ofzdLOGFILE
fgyvoast
fgyv
BLOBlwdnp 42000
mbDBnd 42000
mbfnd 42000
nkvfod 42000
mld
mlws 42000
mbPARAMCOUNTqows 42000
mbvoqows
mlf 42S02
oiwvTWICE 42000
cnrtktv
mhEXTENSION 42000
fsawdth 42000
yynsFULL
mlowoz 42000
nksoqv
nksotw
nkvfROWSIZE 42000
STACK_OVERRUN
mbOUTER_JOINrz 42000
rbmcpimu 42000
lFINDrk
lINITIALIZErk
rkofPATHS
rknh
lrcLIBRARY
lFIND_DLzn
nbgzl
zrunBLOCKED
zrgPRIVILEGED
msopnm 42000
msgmq 42000
msofvn 42000
omwe
lmwqw
mbmjsptaqu 21S01
lREOPENf
ctvtcrb 22004
old 42000
MIXtcnrtktutw 42000
xjrh 42000
TABLEACCESSpjd 42000
COLUMNACCESSpjd 42000
qarhoaf 42000
rhmbzrORnm 42000
ofwjf 42S02
xjfrh 42000
gmqsj 42000
tbd 42000
!baUNUSED1
!baUNUSED2
ABORTINGsk 08S01
zyyxnkzv 08S01
zypedFROM_PIPE 08S01
zyFCNTLd 08S01
zyPACKETSrttcse 08S01
zyUNCOMPRESSd 08S01
zyped 08S01
zypexi 08S01
zydtast 08S01
zystxi 08S01
nkpxrx 42000
flysBLOB 42000
flysqjtm 42000
!baUNUSED3
mbmcnd 42000
mbnfmc 42000
mbMRGf
utzd 23000
BLOBnfpwrf 42000
tplwdrb 42000
nksoROWS 42000
putpnf 42000
!baofRAID_COMPILED
ompwnfpiSAFEnv
nfsugEXITS 42000
ppofwjf 42000
ppgqr 42000
lDO_THISuuANna 25000
duuxb
duuuk
duuFLUSH_LOGS
!baduuCHECKPOINT
NEW_ABORTINGsk 08S01
!baDUMPgqr
!baFLUSHqfiCLOSED
!bamuREBUILD
ni
nizype 08S01
nizyst 08S01
FT_MATCHINGnfgox
raORynna
mlovoq
CRASHEDtaUSAGE
CRASHEDtaREPAIR
WARNINGgxruk
TRANSzfFULL
!batrsawi
mggrd
tfmg
skug
mgqw
nksonmCONNECTIONS 42000
ozCONSTANTSpl
raWAITre
rafFULL
peplna 25000
!bapkDBngpera
!bamwDBngpera
mbARGUMENTS
ofPERMISSIONqomwnm 42000
!baUNIONqvpitjDIR
raDEADLOCK 40001
flysFT
kADDpc
ofqlqu 23000
quunql 23000
CONNECTqoni 08S01
!basftaqf
dttEXECUTINGsj
mbUSAGE
mbvxtcthpiod 21000
lomngREADLOCK
MIXINGgmq
utpg
nmqdREACHED 42000
SPECIFICojpjd 42000
LOCALoq
yroq
ofnp 42000
mbmjoawb 42000
mbnzoawb 42000
wblyope
ltvobHERE 42000
geYET 42000
niFATALdREADINGi
mgrsf
uvyrLOCALwb
mbwyDEF 42000
nfREF_DOgvnfREF
OPERANDth 21000
yfof1qu 21000
mltztl
slHELP_DB
!baCYCLICtq
qjvk
qatq 42S22
DERIVEDsawdALIAS 42000
odREDUCED 01000
TABLENAMEgmqHERE 42000
gezenv 08004
ullwdrb 42000
tgqznl 42000
!batrWASrd
!batrWASgrd
nkvfoaUNCOMPRESS
ZLIB_Z_MEMd
ZLIB_Z_BUFd
ZLIB_Zosd
CUTmjnrCONCAT
jnkFEW_RECORDS 01000
jnksoRECORDS 01000
jrbqoNOTNULL 22004
josrttcnj 22003
!josts 01000
jUSING_OTHERtl
lrg2COLLATIONS
!bapknm
REVOKE_GRANTS
lrg3COLLATIONS
lrgNCOLLATIONS
oqungSTRUCT
mltg
mgrsSSL_PARAMS
!barwunpizazenv
joiRESOLVED
tfmgUNTIL_COND
mrSKIPmg
UNTIL_CONDrs
mbndoamu 42000
mbndoaCATALOG 42000
!bajQC_RESIZE
tfFTmc
mlnfzf
jHOSTNAME_WONT_WORK
mlSTORAGEmz 42000
jmatb
srUPDATABLEf
ufpq
obptpf
DUPLICATEDmjpinz
tsmbmj 22007
!bankMUCHqjrjCOLS
ctaom
mhPS
GET_ERRMSG
GETvaERRMSG
mlTIME_ZONE
jcrj
cowrx
jmqyxOVERFLOWED
CONFLICTING_DECLARATIONS
ssofrimw 2F003
ssronh 42000
sssugrr 42000
sspkme
ssyeme
ssLILABELnl 42000
ssLABEL_REDEFINE 42000
ssLABELnl 42000
ssUNINITwb 01000
ssBADSELECT 0A000
ssBADRETURN 42000
ssBADSTATEMENT 0A000
ommnmars 42000
ommnmaTRANSLATED 42000
sfxi 70100
ssmboftcARGS 42000
ssCONDnl 42000
ssNORETURN 42000
ssNORETURNEND 2F005
sstfupsf 42000
sstfupod 42000
ssupnl 42000
ssuprorc 24000
ssupgrc 24000
ssUNDECLAREDwb 42000
ssmboftcFETCH_ARGS
ssFETCHofos 02000
ssutyb 42000
ssutwb 42000
ssutCOND 42000
ssutCURS 42000
ssloe
ssSUBSELECT_NYI 0A000
tzgmqpiSF_ORvg 0A000
ssVARCONDteCURSHNDLR 42000
ssuptetl 42000
ssCASEgox 20000
xdnkvfns
xdtfsy
xdEOFpirp
xddpito
xdEOFpimlto
pvofsn
!baFRMmlnz
mbsz
NONUPDATEABLEmc
!bapvodDERIVEDrz
pvodsw
pvodoq
pvodTMPTABLE
pvmbtx
jpvMERGE
jpvpwnf
pvc
ssofpkss
!bassGOTOpiHNDLR
vgronh
vgsugrr
vgtapvORumf
vglmvqu
vgofwjqupivg
ofnpoaoi
DIVISION_BY_ZERO 22012
tsmbmjoaoi
qamjoanz 22007
pvNONUPDpp
pvppme
PROCACCESSpjd 42000
RELAYmnwc
!baPASSWDrf
mlzci
IOsxmnmupe
ivqPROHIBITED
FSEEKwc
ivqFATALsx
mnpitv
mnvqmlsx
RELAYmnzs
ofBINARYtn
RESERVEDtb
!baWSASme
!baDIFF_GROUPS_PROC
!baofnroaPROC
!basengPROC
!batnPROHIBIT_CHANGINGtc
!baofnsMAPPING
!bambMAGIC
PSsoyb
nfwg0
pvCHECKSUM
pvMULTIUPDATE
pvofuwoitx
pvuqMERGEpv
knm
XAER_NOTA XAE04
XAER_INVAL XAE05
XAER_RMFAIL XAE07
XAER_OUTSIDE XAE09
XAER_RMERR XAE03
XA_RBROLLBACK XA100
xjPROCrh 42000
PROCqjrhwc
PROCqjREVOKEwc
osnkpx 22001
sstfSQLSTATE 42000
STARTUP
svFROM_FIXEDpoROWSqowb
lmwnmngrh 42000
mbmjoanz
fDEFzh
ssuttl 42000
ssgwbARG 42000
ssofRETSET 0A000
lmwotsz 22003
!bameROUTINE_BREAKi
ineROUTINE
imwROUTINE_NEED_SUPER
!baEXECtzngrcup
tzHASofrcup
xbgmqpiSF_ORvg
ofnpoapvoi
ssofuy
nkvfSCALE 42000
nkvfPRECISION 42000
M_BIGGER_THAN_D 42000
mbratcovf
CONNECTqopcosni
sftapcosni
pcosniusrr
pcosrxclmw
pcosrxc
!balmwFEDERATEDf
vgpimboc
STACK_OVERRUN_NEED_MORE
nkpxBODY 42000
jlpknpKEYCACHE
nkvfDISPLAYWIDTH 42000
XAER_DUPID XAE08
xtnbui 22008
lomsbfpiSF_ORvg
pvPREVENTom
PSofuy
sslozAUTOCOMMIT
!bauxzm
pvFRMofnm
pvOTHERnm
ofwjnm
FORBIDocmv
quunql2 23000
ofqlqu2 23000
sstfwbSHADOW 42000
vgofzm
OLDnsnw
ssuyqd
!bassPROCfsl
ssmbnd 42000
fNEEDS_UPGRADE
ssofrg 42000
qsPREPAREDtzspREACHED 42000
pvri
srxwoisb 42000
flysSPKEYS
ofTRIGGERStaovoc
REMOVED_SPACES
ubpeme
USERNAME
HOSTNAME
mbrxrf
srINSERTABLEf
ADMINmbMRGf
nkHIGH_LEVELtcNESTINGoaod
ndBECOMESpr
AMBIGUOUSoiTERM
pcrwnh
pcrwusrr
qaHAmwob
hpuvdd
hmbvdd
hMAXVALUEd
!bahuad
!bahSUBPART_MIXd
hmbofwgd
hmbofSUBPARTd
mbEXPRpihtkd
!baofCONST_EXPRpinjORtxd
oigoxwgd
!batxtctwplpiHASHd
qchwed
htkgmqd
yjsayozld
njgINCREASINGd
qcnztcFUNCTIONSd
pbDEF_CONSTpitxwgd
hznd
MIXtld
hgzld
nksoyjd
uad
lmwtlns
BLOBoipiwgtkd
zdnfNEED_ALLtwpiPF
ofPARTSd
hMGMTtaym
pcnftaPARTITIONED
pkhsrEXISTENT
pkLASTh
COALESCEpltaHASHh
REORG_HASHpltawhof
REORGofybd
pltanjtxh
ADDhSUBPARTd
ADDhofNEWh
COALESCEhofh
REORGhgrr
whndh
ofid
CONSECUTIVE_REORGyj
REORG_OUTSIDEnj
hnbon
!bawgSTATEd
LIMITEDwgnj
nxungLOADED
mbmj
ofhoaGIVENmj
wmobplONCE
mwwmme
pkwmme
mkqjEXTENDd
mbpovx
pouid
oewmme
iqutnme
!baiqumbfDEF
!baiquRBRqoSBR
ogronh
!baogyeme
ogsugrr
!baogloe
!baogpkme
ogxygPOSITIVE_ORnkvf
ogENDSypSTARTS
ogEXEC_TIMEpiTHE_PAST
!baogrcfme
!baogNEITHER_M_EXPR_NOR_M_AT
!bavhspusvnuo
!baksvFROMf
!baogkuq
!baogCOMPILEd
ogwhnd
!baogosnkpx
pkmuwy
jmatbngVER
!balstramnf
lramnf
pcpmnfOLDrz 23000
vhspusvnPLEASEom
!baumfptryrttcRBR
zbnbptryinw
!baNDBlryinw
hofva
hCONST_DOMAINd
hnbungmq
!baDDLmndrz
rbpivdLESS_THAN
mbhnd
lmvTX_CHARACTERISTICS 25001
utznAUTOINCREMENT_CASE
!baogMODIFY_QUEUEd
ogozwbd
hMERGEd
!balACTIVATEmn
!baRBRgwk
BASE64_DECODEd
oguyzp
!baEVENTS_DBd
plINTEGERSmq
UNSUPORTEDmnmz
tfmnpf
lRENAMEmnf
mbPARAMCOUNTqovwFCT 42000
mbvoqovwFCT 42000
mbvoqozbFCT 42000
vwFCTndwl
utznngnfnd 23000
ivqEMFILE
ogkmwpiTHE_PAST
ogkoepiTHE_PAST
!batrINCIDENT
ofhoaGIVENmjSILENT
inepf
iFATALd
!batrRELAYmnpeon
!batrRELAYmnston
!batrmwogon
!batrqfCOMon
itnIMPOSSIBLE
pvofudCTX
pvcudCTX
!baSRcudCTX
vguons
vgofudCTX
vgcudCTX
ogcudCTX
vglrcf
!balmwSROUTINE
!baNEVERsb
ofnwDESCRIPTIONogypipf
mgslog
!basvoscmcrz
mnvqofns
XA_RBTIMEOUT XA106
XA_RBDEADLOCK XA102
NEED_REPREPARE
!baDELAYEDge
!jofskug
!jobrs
nxuqBUILTIN
!jnxBUSY
oqunyc
jmznauk
!batrwpon
mgwpmjrttcnj
NDBmyocd
ucFNwqd
EXCEPTIONSstd
nkpxfrp
nkpxoirp
tkINEXISTENTndwl 42000
DATABASEnd
fnd
hnd
uand
vand
RENAMEDnd
nksoyhTRXS
!jsrASCII_SEPARATORgqr
DEBUG_SYNCre
DEBUG_SYNC_HITqd
utxmoz 42000
xmj 01000
xmgox 02000
xmpn
RESIGNALpwyntl 0K000
xmtftinz
!jCOND_ITEMts
COND_ITEMnkpx
mlLOCALE
mgytrwIDS
!basfzfpq
whndhoi
hmctxd
mbnzmcmjd
nksohtktwd
MAXVALUEpivdpi
nksovdd
quSINGLEhoid
oinzgmqAShoi
htwnkpx
iqumztutzmz
iqunvtutzmz
inetutzmz
iquzttutzmz
itznvtuqumz
iquzttutznv
ipbENGINEStuSELFtnmz
ineqd
!baUNUSED4
ineovf
ineubth
inerk
ineovoq
ineovnb
ineNONTRANSteTRANS
MESSAGEtupf
!batrqkme
mglmwqk
INSIDEnaptryinw
vprf
jmatbofREPLACEMENT
mbvwfSTRUCTURE
mbPERFSCHEMA_USAGE
jI_S_SKIPPEDf
INSIDEnaptryiDIRECT
zbnbptryiDIRECT
ulsawdGEOMvh 42000
nkpxmurp
raABORTED
osrttcnj 22003
!bambSPVARnzpiqd
inepbENGINEStuSELFtnmz
ineMIXEDpf
INSIDEnaptrywwmnBIN
zbnbptrywwmnBIN
mepeFROM_PARns
vdungINTnzd
ojpjofmsd 28000
!baozmszenx
!barhnxnmnh
TRUNCATEqawy 42000
nxunPERMANENT
mgwpmjrttcnjMIN
mgwpmjrttcnjqs
tzzfFULL
MULTIomnfuc
fNEEDS_REBUILD
!jobBELOWqd
mumcnkpx
dpixnBODY
dpimlxnBODY
musl
UNDOyynkvf
ineuwytod
ineuwodom
ineREPLACEod
inemwytod
inemwREPLACEod
ineomyt
nxofUNINSTALL
nxofxg
inestubod
inemwodub
ineuwTWO_KEYS
fpiwypp
mhmz
ineubgFIRST
ksvFROMfV2
niDELAYmjrttcnj
plFDtuRBR_EVENTSmqpiipf
hxutjob
hxuwgf
hxuumf
hINSTEADtcua
mlh
qvtjug
qusugvnh
izfpoGREATER_THANqs
jmugAPPLICABLE
hxupcnf
!baofwjnfmj
rnweosnkpx
!baNETWORKpeogCHECKSUMon
!baipeogCHECKSUMon
itzzfpoGREATER_THANqs
lomfpimwfod
hswtaym
qusugvnGIVENhoz
!baofwjh~rz
mvrnwevron
WARNINGgxrukngCREATEDumf
WARNINGgxrukngDROPPEDumf
MTAufunge
MTA_UPDATED_DBS_GREATERqs
MTAlPARALLEL
MTAqcos
xvgengPARTITIONING
xsctivx 35000
INSECURE_PLAIN_TEXT
INSECUREmvni
pcpmnfngziwe 23000
pcpmnfpwziwe 23000
SQLTHREADngzamg
fHASofFT
oqgydpiSF_ORxn
oqgydpina
!bamiuhungpimiuhtx
!balmvmiuhpina
ozpfkINVOKEnb
miuhlyoAUTOMATIC_IFmiuhtxunsrrb
!baSKIPPING_LOGGEDna
uxmiozSPECIFICATION
uxmiozENCODING
uxmiSPECIFICATION
GNO_EXHAUSTED
tfmgqjtd
qjtdpuminvgya
lDO_IMPLICITxbpiTRXttmiuhunoz
minvtapuENFORCEmiqqta
!baminvpui
lozmiuhqomittminvunya
lozmiuhqoopttminvunta
lozmiuhtxqosrrbttminvunya
!baoxmiogttminvunya~rz
minesrTRANSACTIONALf
minemwod
!baminemwpkumfpina
minvCANplmvONE_STEP_AT_A_TIME
niHASvyvzxx
lozmiuhttOWNINGmi
mlsnnw
lEXECUTEpipeplna 25006
nkpxfhrp
mgvj
mpFTqd
mpofFTumf
mpFTmbDOCIDmc
mpFTmbDOCIDmu
mpONLINEmnnkvf
mloesc
mloera
MTAmvnilRUNngGAPS
MTAsgon
MTA_RESET_WORKERS
vhspusvnuoV2
mgSILENT_RETRYna
DISCARDwyxard
focnl
fpiovmk
IOped
IOstd
mkmr
mknh
mkDISCARDED
INTERNALd
mpxfd
mpmusl
cYEARmcrf
gVALIDms
samvms
wyofmuzi
wyofmuxk
wywcADDov
wykrcxk
wyuvob
wyutnd
msnw
wymckpk
wymckpkzi
wymcgrb
utmu
wymckmv
wymckmvzi
!baUNUSED5
uxyx
peplnv
miuhnzUNDEFINEDmi
oqgydpiss
!balozmivyttminvunya
lozmivyttmiueungpr
lozmivyttOWNEDxxungpr
mivyWASzh
miueWASzh
itznvtuofREPLqv
oemtge 0A000
oemtgeqh 0A000
oemtgeqhCOPY
oemtgeqhh
oemtgeqhwyRENAME
oemtgeqhmcnz
oemtgeqhwypp
!baUNUSED6
oemtgeqhNOPK
oemtgeqhub
oemtgeqhHIDDEN_FTS
oemtgeqhmvFTS
oemtgeqhFTS
!bawwmgSKIP_COUNTERgydpiminv
utmlpimu 23000
IDENT_CAUSESnkpxvp
oemtgeqhgrb
samvmsLOGIN
qupimbh
MTAogBIGGER_PENDING_JOBSpoqs
!bampofFT_USESqt
iLOGICAL_CORRUPTION
jvqmnpitv
jvqmnunyn
qjtmuc
!jtaBLOCKHOLEpiRBR
mgCMzsvr
mgAMzsvr
ojpjmvnmd 28000
mppepl
wimgwwqwre
wimgIOqwre
fsl
umnsston
mpFT_AUXgHEX_ID
OLD_TEMPORALS_UPGRADED
mpFORCEDsg
AEScIV
nxkyoUNINSTALLED
mineiSPLITTABLEpftuASSIGNEDmi
mgHAS_MORExxTHANni
mrnf
!jNAMED_PIPEojEVERYONE
@3000
nssl
dtani
!baqcd
STORAGEmzgLOADED
GET_STACKEDxspwyntl 0Z002
jLEGACYtbCONVERTED
inexvnx
kDISCARDvaf
wyDEPTHph
vhspusvnPLEASEomV2
jxnuswdCREATED
qlvgsugrr
snge
coipo
mrHAmwob
mzrttcMEMORY
msEXPIREopnm
mgwwqwsawi
ofFT_MATERIALIZEDyf
mpUNDOmnFULL
cpgoaLOGARITHM 2201E
mgoyIOqwsawi
jrcumqvsayoZERO
jplnimnnsofPOS
sfre
srROodsmTIMER
uttxzn
!bawwnvofEFFECT
rgseoaUNION
rgsesrAGGsf
mgWORKER_STOPPED_PREVIOUS_THDd
!baDONT_SUPPORTmgPRESERVExbse
rwOFFLINEnv
GIStjSRIDS
GISmhpg
GISmld
GISmlpn
GIScos 22023
xqotprINPUTpn
xqotCENTROIDpn
xqotOVERLAYcINPUTpn
xqotTURNwepn
xqotSELF_INTERSECTION_POINTpn
xqotmlpn
STDtfALLOCd
STD_DOMAINd
STDrfd
STDcpg
STDrttcnjd
STDuid
STDnjd
STD_UNDERFLOWd
STD_LOGICd
STD_RUNTIMEd
STDmlpn
GISosmbENDIANESS
mvnimsrf
nmrambnd 42000
nmraDEADLOCK
REPLACE_INACCESSIBLE_ROWS
oemtgeqhGIS
qanmwb 42000
minvya
!bamhBYmyqw
uvnz
oipisegod
rgpisegod
crnWILDfqePATTERN
zyOKyxnkzv 08S01
cmxos
czqmrMEMBER
czqmbnz
czqUNSPECIFIED
DIMENSIONmh
mgoysugrr
!batrpbCHANNELSzrPORT
mgoyndcORnkpx
mgNEWoymbvr
!batroyuq
mgpbCHANNELS_CMD
mgqsCHANNELSph
mgoysawi
mgoygrd
mgoyWASrd
mgoyWASgrd
mgoywwqwsawi
mgoywwSKIP_COUNTER
mboingnrV2
MIXtcnrtktutwV2
jmaSYSVARom
jmaSQLMODE
kmnujpkDATABASEngmi
nrmyvj
nrmyrd
nrmyqyzsd
nrmywiqyqwre
nrmyviLAYERvsd
nrmyviLAYER_JOINd
ypDMLvud
ptoqpwRBR
RUN_HOOKd
naukuuxb 40000
ncmcnbungmq
mhoeINPLACEtaxpmc
mbwyoboancmc
srnpmjoancmc
mhACTIONtancmc
ncmcsrPRIOR
urBYncmc
ncmcREFqjINC
ufgwk
lozminv
ltvqjtdngminvya
!balwuopngqjtd
!balwuopngminvta
!balwumingminvya
lENFORCEmiqqngONGOINGmiVIOLATING_TX
ENFORCEmiqqjngONGOINGmiVIOLATING_TX
ACCOUNT_HAS_BEENyv
mbmknd 42000
mkungpr
mbnsnd
xqotqcTURNSpn
jOPTIMIZER_HINTtbd
jtfqszoTIME
jmhqszoTIME
jCONFLICTING_HINT
jmlQBnd
UNRESOLVED_HINTnd
jtaMODIFYINGmiuef
PLUGGABLE_PROTOCOLsjge
LOCKINGqbmbnd 42000
LOCKINGqbDEADLOCK
LOCKINGqbre
GISqsPOINTSpiotOVERFLOWED
wwnvMERGED
!baVTOKENnxTOKENnl
!baVTOKENnxTOKENgox
lozoqttOWNINGmi
mgoymtgmq
cmxTEXT 22032
cmxTEXTpiyb 22032
cmxBINARYos
cmxvp 42000
cmxqz 22032
cmxqzpinb 22032
cnzoamx 22032
cCASTqomx 22032
cmxvpqz 42000
cmxvpWILDCARD 42000
mxmjnkvf 22032
mxnfnkvf 22032
mxsbASnf 42000
mxVACUOUSvp 42000
mxtfONE_OR_ALL_ARG 42000
NUMERICmxmjrttcnj 22003
cmxmjoaCAST 22018
mxDOCUMENTnkDEEP 22032
mxDOCUMENTrbnf 22032
zaTRANSPORTvz
ofzaTRANSPORTS_CONFIGURED
pqSTORAGEmz
nmsugrr
nmronh
mmAPI_ABORT
cmxvpARRAY_CELL 42000
BUFPOOL_RESIZE_INPROGRESS
ufpqSEE_DOC
rwISNTwk
vsWAS_KILLED
CAPACITYph
CAPACITYphpinjOPTIMIZER
!bafNEEDS_UPGwg
lWAIToauemiozWHILE_OWNING_Ami
kADDpcBASEvhxp
kmwxpmuno
dtaMODIFYINGmiuef
raREFUSED_BYmz
mhoeONLINEtaxpmc
qfnfrmgeBY_SE
!baqfnfrmdBY_SE
qfnfrmime
qfnfrmSE_UNAVAILABLE
mkkENCRYPT
cmoob
kFINDnfpipd
CAPACITYphpiqt
mhoemoINPLACE
pdrkpdqbd
nmmcOLDrf
lRESETni
nrmyqsnrpo
kADDpcBASEvhzb
fql
!bahmzmaoaf
!bajUSING_GEOMFROMWKBqoozSRID_ZERO 01000
!bajUSING_GEOMFROMWKBqoozSRID 01000
XA_RETRY
pdAWSrkAWS_KMSd
ineXA
rkd
pdMIGRATIONon
pdojpjd 42000
pdMIGRATION_STATUS
!banxmeqorcqv
!banxmeqorcf
!bammmnofpdnxzu
!bammmnmomsHASgBEENoz
!bammmnCOULDgmwAESnf
!bammmnmomskyoFETCHED
!bammmnmxFILTERINGgENABLED
!bammmnrkwfpy
!bammmnSUPERpyvz
!baCOULDgREINITIALIZEmmmnvm
!bammmnrkcpgnz
!bammmnrkcpgsp
!bammmnHASgBEENzu
!bammmnrkpecqsARRAYrfARGnz
mmmnrkpecqsARRAYrfARGmj
!bammmnmxqezzd
!bammmnmxqendkyopr
!bammmnmxnmndkyopr
!bammmnmxqesugnh
!bammmnnmFIRSTowsayoALPHANUMERIC
!bammmnnmndcow
!bammmnzrndcow
!bjmaMAXDBwwnvoarj
!baXAmyvm
!balrcdmn
!baxwtarjpiDST
!balwxrwNAMED_PIPE
stozrqqd
!bamaTLSqnvs57
!bajmaTLSqn57
!bajmbvwfSTRUCTURE
AEScKDFnd
AEScKDF_ITERATIONS
!jAESnfpo
AEScKDFobpo
@3500
UNSUPPORT_COMPRESSEDvaf
ACLmtme
mhmusc
ofwjDB 42Y07
nkvfENUM
nkpxozENUMmj
cDDsz
UPDATING_DDf
cDDszID
cDDsznd
mkmrngnd
nkpxROUTINErp
sssvme
cBITWISE_OPERANDSpo
cBITWISErgOPERANDSpo
jmhHINT
paotnz 22S01
qmwqd SR002
qmPROJtomr SR003
jqmgox 01000
qmgzg 22S00
qmgzgUNDEFINED SR001
PKmulyoINVISIBLE
mlAUTHID
mexlrh
rcxlqv
menpROLES
ohofSCHEME
ohofSCHEMEqb
ohlsv
xlgGRANTED
meREVOKExl
RENAMExl
ohlACQUIREqbyl
ohlSATISFY_DEPENDENCY
ohsvlREGISTERqbyl
ohsvlINITIALIZE
ohxogLOADED
ohxolDEINITIALIZE
ohlRELEASEqb
ohxolUNREGISTERqb
ohlxo
jxoTHEgwr
mffuv
mfMANIPULATEqume
ohxopmpinr
lozmivyDUE_SETS_CONSTRAINTS
kranmMANAGEMENT_CACHES
qmgox SR001
oqgwr
unsfcsw
vcqoyevt
ofovocoj
ofovmkoj
ofovfoj
ofovfojoaDICTIONARYf
ofovfojoaovf
ofovfojoaf
cobnf 22023
cobmj 22023
cobnfmjPAIR 22023
cobwxow 22023
cobENDow 22023
cobCHARACTERS 22023
pmobnf 22023
jqmgoxAXISse 01000
ofojqovwFCT
RESETniqomjrttcnj
UNRESOLVEDfra
pmfra
ineSKIPyv
ineNOWAIT
raNOWAIT
CTEripuUNION
CTEripuNONRECURSIVE_FIRST
CTEriFORBIDS_AGGREGATION
CTErizpJOINse
CTEripuSINGLEtq
ryTMPmz
nnofwjnn
nnCIRCULARITYpinnGRAPH
nnofziPARTITIONING
nnofINHERITwo
nnofREDEFINEseBY
nnwowxqa
nnwoENDqa
nnwoqa
nnnjwosenz
nnnjwoTEMPORALnz
nnnjwoNUMERICnz
nnnjBOUNDgCONSTANT
nnpmnd
nnqaseBY
nncnntktv
nncnntkALIAStv
nnywnntktvpinnSPEC
nnROWSxytv
nnofnrserz
nnsnmx
nnnbIGNORESwo
WL9236_NOWrz
coftcARGS
oipixwgnrBY
nkpxmkrp
mzlpkf
mzlpkmrf
mkutFILENAME
DBpkRMDIR2
IMPofwnMATCHED
IMPocsugrr
IMPfronh
IMPorMYSQLDqn
IMPorDDqn
IMPorSDIqn
jcHINT
wbsugrr
zxrttcnj 22S02
xzrttcnj 22S03
gqroaGEOGRAPHICqm 22S00
qapyLEVEL
ofovpvoj
mfqeFLABBERGASTED
wgEXPRnkpx
rkpkDYNAMICALLY_REGISTERED
vcqoyemcvt
vcqoommcvt
vcqopkmcvt
vcqoBUILD_HISTOGRAM
sdxl
mrmkns
PERSISTplojpjd 42000
!baCMD_NEED_SUPER
vppiDATADIR
qxDDLpiPROGRESS
qxnksoyhCLONES
qymnogvud
CTEqsuyDEPTH
gHINT_UPDATABLEoq
CREDENTIALS_CONTRADICTqoHISTORY
WARNINGmsHISTORY_CLAUSES_VOID
oksugSUPPORT
I_S_SKIPPEDmk
mkmznl
mbSRIDoamc
koeSRID_DUEqomu
jiujUPDATESpq
!bajiV1quEVENTSpq
jiujUPDATES_SUGGESTSujIMAGES
COULDgAPPLYmxDIFF
uomxDIFF
rlnrnh
rlnrgnh
cVCPU_ID
cVCPUnj
cqwPRIORITY
vlmt
rlnrBUSY
rlnrpq
ufmh
qirs
cqwID
rlnrBINDme
ctvtcFORCEob
nrmysjon
SDImtme
mrmxfmj 22035
mbmxfmj 2203F
TFsawdALIAS 42000
TFzpJOINnz
JTmjrttcnj 22003
JTqsywvp 42000
msEXPIRATIONgeBYzeMETHOD
czqCRSgTOP_LEVEL
tfrbdgrs 23000
!jUSELESSulmu
DISK_FULL_NOWAIT
wqdpiDIGEST_FN
UNDISCLOSEDwqdpiDIGEST_FN
ocDIRnh
ocDIRmr
ocDIRmwme
ocDIRml
plqroaSRID_0tu4326 22S00
!baiEXPIREmnDAYStuSECSsbTOGETHER
olyqui
olqapg
olmuOUTOFBOUNDSd
olINTERNALd
olRULEtb
oltfESCAPE_SEQUENCE
olUNIMPLEMENTED
olMISMATCHED_PAREN
oltfxy
olqsLT_MIN
olcBACK_REF
olLOOK_BEHINDqd
olmrCLOSE_BRACKET
olcnj
olSTACKui
olTIMErt
olPATTERNnkvf
lozdmnqb
prPIPELINEoadmnqb
mfqeDIAGNOSTICS
gqroazgqm 22S00
gqroaPROJECTEDqm 22S00
NONPOSITIVE_RADIUS 22003
RESTARTrwme
qmmrsdqi SR006
qmpbqiDEFINITIONS SR006
qmndlyoprOR_WHITESPACE SR006
qmORGANIZATIONlyoprOR_WHITESPACE SR006
qmIDronh SR004
jqmIDronh 01S00
lMODIFY_SRID_0 SR000
jRESERVED_SRIDnj 01S01
lMODIFYqmsbBYmc SR005
qmcowpiqi SR006
qmqirxnkpx SR006
maUTF8_ALIAS
maNATIONAL
cnpUTF8MB4tg
vcqoCOLLECTmnSTATUS
RESERVEDmknd
vcqoozob
mgPOSSIBLY_DIVERGEDteDDL
qmgGEOGRAPHIC 22S00
POLYGONnkzv 22023
ulzdmu
munzgeoaulmu
wykpkxk
otybzxrttcnj 22S02
otybxzrttcnj 22S03
wyktvxpmc
wyofmcxk
lozdSUPPRESSIONtx
qmGEOGCScAXES SR002
qmcSEMI_MAJOR_AXIS SR002
qmcINVERSE_FLATTENING SR002
qmcANGULAR_UNIT SR002
qmcPRIME_MERIDIAN SR002
vbniqmge 22S00
vbzcqmge 22S00
vbniqmmrTOWGS84 22S00
vbzcqmmrTOWGS84 22S00
umfptryvsinw
umfptryyrinw
rdqyptryyrinw
okminemwpkumfpiTRXpiSBR
!baXAlmwMDL_BACKUP
fpwPK
jostsntmu 01000
josrttcnjntmu 22003
ntmutamxORotnb 42000
ntmuREFqjtm
kpkmcntmu
ntmutpnf
ntmutaLOB
ntmunbungmq
xvntmu
ulntmu
mbnfmcntmu
ntmutaoi
ncmcNAMEDnbungmq
ncmcqumj
ncmcve
urBYnpncmj
npVALncsrPRIOR
npVALncREFqjINC
npVALncnbungmq
npVALncNAMEDnbungmq
npVALncqumj
npVALncve
npAS_VALnc
mhACTIONtanpVALnc
mineoeADDvhngnpEXPRESSION
wykmvmz
jmanmozEXPR
jmaUTF8MB3tg
jmaywrptb
wyorth
GR_HOLD_WAITre
GR_HOLD_KILLED
GR_HOLD_MEMBER_STATUSd
rnmomeqoFETCHnf
rnmonfgox
rnmopdcnf
rnmosyd
rnmomeqoyzLOGS
rnmonfnhpa
rnmomeqoGENERATEnf
rnmomeqoyenf
rnmomeqoREMOVEnf
rnmovcqomvob
rnmoqfnfsgme
SLOWmnnvrsttgtnqons
xeTRXqqgmq
xeTRXqqyp
xeTRXqqtetaTRX_BEGIN
xeTRXqqBEGINgmq
ntmuqumjungmq
rnmomeqoENCRYPT
PAGE_TRACKINGgSTARTED
PAGE_TRACKINGnjgTRACKED
PAGE_TRACKINGkvq
rnmokyziqfnf
iqfnfsgrttcCOMBINATION
iqfnfrmwcqoOPERATEnf
iqfnfrmwcqoyzLOGS
iqfnfrmwcqoREENCRYPTmn
iqfnfrmwcqoCLEANUPrzKEYS
iqfnfrmwcqoCLEANUP_AUXnf
srBOOLEAN_EXPRoappno
mcppnoREFERENCES_OTHERmc
ppnoNAMEDnbungmq
ppnonbungmq
ppnove
ppnoqumj
ppnoREFERSqjtmmc
ppnoVIOLATED
ppnoREFERSmlmc
ppnogox
ppnoutnd
ppnoswUSINGwyREFER_ACTIONmc
!jUNENCRYPTEDfpiENCRYPTED_DB
cmoREQUEST
kozfmo
kozDATABASEmo
kozmkmo
mkkyoENCRYPTED
mkkyoDECRYPTED
mknzml
zcmkUNENCRYPTED
ktvmosw
cpbCLAUSES
mhtvtcrhAS
UKNOWNzeID_ORojpjoarhAS
urBYntmu
nxgEARLY
mptymnpzwxSUBDIRvp
mptymnpzwxre
mptymnpzDIRSc
mptymnpzLABELgox
mptymnpzDIRpr
mptymnpzofwjDIR
mptymnpzDIR_CLASH
mptymnpzDIR_PERMISSIONS
mptymnpznsmw
mptymnpzyn
mptymnpzINACTIVE
mptymnpzme
mptymnpzvs
STD_REGEXd
cmxnz 22032
kvkrx
urBYhtk
jmaFLOATqjtm
rnlwimgWHILEyvBACKUP
jmaFLOAT_DIGITS
jmaFLOAT_UNSIGNED
jmaINTEGER_DISPLAY_WIDTH
jmaZEROFILL
qxDONOR
qxPROTOCOL
qxDONORqn
qxOS
qxPLATFORM
qxqz
qxCONFIG
qxSYS_CONFIG
qxnxvn
qxLOOPBACK
qxmo
qxDISK_SPACE
qxpiPROGRESS
qxvl
krhROLESqoopnm
uzmznx
SECONDmskyopr
DBojpj
xszeIDngovnmPRIVpisdROLES
xsrnmifkrc
otpimlrfUNIT SU001
xsnxxgd
ofvsum
xsmldvx
mcmvpo
olcCAPTUREnrnd
xsSSL_LIBRARYd
uzmz
uzmzDDL
uvzkms
mrzkms
zkmsgvz
mskyoRETAINEDtanxmv
zkmskyoRETAINED
ujREVOKESrr
krhovPRIVqosdxl
XAmyvm
mhwwnv
olcFLAG
ujREVOKEtuDBrhBOTHnh
UNITgox SU001
cmxmjoatkmu 22018
mxmjrttcnjoatkmu 22003
phMV_KEYS_NUM
phMV_KEYS_SPACE
ntmuosunnkpx 22001
mbMVImj
jtkmugAPPLICABLE
xernrkd
ommivyngGR
xwtarjpiDST
fndCAUSESnkpxvp
mmmnwfpy
!bammmnmsHAS_BEEN_COPIED
xsxernSTARTEDqjREJOIN
SYSVARmvuusf
GLOBSTATmvuusf
xernMESSAGEqbzson
mvnimbqpscok
mvnimbqpLEVELok
mbqpscok
mbqpLEVELok
mvnimbqpsctxok
okpyxanmkyoop
okpyxanmsugrr
okpyxanmsl
okpyxanmNEEDSrnqyPRIV
jxspygREGISTERED
okpdrknfc
okpdrknfnzc
okpdrknfnkpx
okpdrknfnznkpx
mxocvudngDETAILED_REPORT
xsrkcqzwv
xsrkcqz
xsrkctg
xsrkcEXTENSIONpgnz
pbCONSTRAINTSngwhnd
nogox
oenoENFORCEMENTge
fmjCONSTRUCTORsawdth
fmjCONSTRUCTORkwdnp
oksfoncsrqunw
REQUIREqunwcmj
meqoDETERMINE_IFxlunsd
meqoFETCHsdxltx
okLOCALwnpq 42000
IMPorCFGqn
xsOOM
xsrkcpgqoozqz
xsrkcRETURNnzqoozqz
pbINTO_CLAUSES
MISPLACED_INTO
nmojpjoanmACCOUNT_BLOCKED_BYmsra
jmaYEAR_UNSIGNED
qxNETWORKyx
SDImtmemryy
urBYppno
xemtgmqGRsawi
jmamxftadtapr
jmaINNER_INTO
jmavdnbALWAYSrb
jmawwCALCoxROWS
jmaoxROWS
mrmxmj 22035
pbmxvd 22034
HOSTNAMEnkpx
!bajokmahPREFIXnf
nrmynmprMSG
nrmynmsdMSG
nrmymsrf
yfvbREJECTED
xsxernsgENDPOINTnw
xsxernsgENDPOINTc
mbmjoawbPLUS_ACTIONABLEwg
pfgmqtewxna
pcnfngATOMICmwod
gmqngwxna
cmxqi
mzqige
cnmqimx
mptypq
mptyARCHIVING_ENABLED
MDLrttcRESOURCES
IMPLICIT_COMPARISONoamx
nbsugSUPPORTowoz
IMPOSSIBLErxqk
ocpepl
rnASYNCwtminvya
rnASYNCwtqjtdya
smminvpuASYNCwtya
smqjtdpuASYNCwtya
ctotv
owoznl
jwbmjmvge
cTIME_ZONExy
cCAST
yigeYET 42000
!bajyiEXPERIMENTAL
xsofdmnqtCONFIGURED
xsdmnfpq
xsdmnpbvm
xslrcdmn
nmqlASzm
knmqlASzm
REGEXvxnkvf
SPVAR_NONINTEGERnz
!jmhACLqvpe
ineACLfpepiDML_DDL
wimgMONITOR_IOqwre
STARTINGmgMONITOR_IOqw
ltvopqomingminvgta
lCOMBINEopqomituAUTOPOSITION
ASSIGNxxqoopTRANSACTIONSpuminvta
wwmgSKIP_COUNTERsbngminvta
USING_ASSIGNxxqoopTRANSACTIONS_AS_LOCAL_OR_UUID
!baozmiqoANONtuWAIT_UNTILwwTHDtexx
lozwwteORypxxngopqomi
opqomiUUIDwhASnrnd
ltvwhUUID_ASnrnd
xernsgoySTILLrd
mpcygpomj
mporngmk
mpygporttcnj
ktvygposw
xlGRANTEDqoITSELF
fsawdA_VISIBLEmc
mpqpon
jASYNC_CONN_FAILOVER_NETWORK_NAMESPACE
okINTERACTIONre
cCASTqoot 22S01
cCAST_POLYGON_RING_DIRECTION 22S04
GIStjSRIDS_AGGREGATION 22S05
RELOADpdon
SDI_GET_KEYScmk
mvrnSRCmbqpscpo
!bajmaTLSqnoaoyCLI
ltvwhUUID_ASpvmvUUID
opqomiUUIDwhASpvmvUUID
xernpvmvUUIDwcGEToq
jADUITmnqspotuPRUNE_SECONDS
jADUITmnqspoCLOSEqoyztapo
KERBEROSmwnm
xgnxucok
xsdmnmfFLUSHme
jwwteMTS_GAPS_GAPgCALCULATED
cASSIGNMENTzc 42000
mtgmqtaGRuz
xernFAILOVERoySTATUS_PROPAGATION
jmmmnnwUNIXrjplttmx
cMFAnxwv
IDENTIFIED_BYmh
cnxoash
nxpush
MFA_METHODnh
MFA_METHODgnh
AUTHENTICATIONqgnl
nxshDONE
cnmoash
nmshme
MFA_METHODScse
MFA_METHODS_IDENTICAL
cMFA_OPERATIONSoaPASSWORDLESSnm
mvmyniofOPTIONSoamipl
mvREPnilsmREQqunwngmipl
mvREPnilsmqjtdngmipl
mvREPnilsmmiplpwPOSITIONS
mvREPnilsmqjPOSpwPOSITIONS
mvREPniGRoyngminvgta
ltvmiplngminvgta
jCsmmiplngniqjPOScPOS
xsSSL_FIPSnvd
mjrttcnj
xvngROLLUP
olmrrl
jolUSINGnp
olmrns
jmatg
yhwsUSAGE
xsyrCONNqd
xsCONNqd
oemtgeqhmcnzxh
jSFrkndwl
kvqingBACKUPra
nksoWINDOWS
MYSQLBACKUPokMSG
rpCONTAINScrx
mdCONTAINScrx
lEXECUTEsjngASSIGNEDmiuh
XAumf
mpqsquqn
!bampxhADDgeqspo
mtgmqWHILEtpmvunrd
jmaxtDELIMITER
jmaSUPERFLUOUS_DELIMITER
kPERSIST_SENSITIVEve
jkSECURELY_PERSIST_SENSITIVEve
jvgronh
IFgnhmhvgnhtatjf
IFgnhmhrkvwFCTndwl
ozmszenxd
!baREDUCED_DBLWRnsuo
!baREDUCED_DBLWR_PAGEox
qmcxztcORIGIN SR002
qmczxtcORIGIN SR002
qmrzPROJtoPRESENT SR002
GIPKmcnh
GIPKmeubmcnh
GIPKmcoegmq
pkPKmcqopkGIPK
mwodngGIPKvlpiSBR
!baxsEXPIRE_LOGS_DAYSrs
CTErigUNION
sjBACKENDmeqoFETCH_SECURITY_CTX
sjqbBACKENDme
oknspyoamyxa
nrmyFORCE_MEMBERSsjon
jmaIDENT
INTERSECT_ALLqsDUPLICATESph
TPsfTHRS_PERxerqTXN_THRqd
tfrjnw
SHAPE_PRIDICTIONrk
qmcHEIGHT SR002
qmcSCALING SR002
qmcZONE_WIDTH SR002
qmcxzPOLAR_STEREwbA SR002
jmaokofocob
fgpr
foftpnf
fpiSHAREDmk
muOTHER_THAN_PK
svnyosUNSORTED
nyEXECUTORd
nyrvzwzsme
nyrvzwd
nyrvrwd
nyrvvid
nysvosme
nyyumcnkvfoaLEFTOVERyq
nyyumfd
nyyunsCONTAINS_LESS_LINES_THANytsw
nyqtmrENCLOSED_BY
nyqtquyqqsTOTAL_COLSph
nyqtCOPYyqpoph
nyqtpaENDtcINPUT
nyqtpaquyk
nyqtpaCHARteENDING_ENCLOSED_BY
nyqtpaCHARterbESCAPE
nyqtpaCHARtemcyk
nyqtINCOMPLETE_ESCAPE_SEQUENCE
svnyosme
svnyosmbmjoaoi
svnyosjrbqoNOTNULL
REQUIREftpnfppGENERATEngGR
lmvSYSwbpipeplnv
mpxhADDpkgeqspo
mpxhADDgeqstw
lozwr
xgmfozrbmj
xgmfozrzmj
jmanmzlCOLLATIONS
nmraOVERLONGnd 42000
jofSPACEqnrp
VALIDATEmswfzhCHARACTERS
jmangNOTE
lRUNsjSERVICES_RECURSIVELY
jmmmnqesgtnpq
@6000
oumf
oumfgwk
oumfmhou
oumfkUNINSTALL
ssofoeou
!basnINTO_ANALYZEge 0A000
snINTO_IMPLICITnwge 0A000
snINTOnwge 0A000
rblyowroayc
snINTOoaskge 0A000
mpxfmbDROPPED_ENUMrf
mpxfmbvxtcINDEXES_ZERO
mpxfmbvxtcINDEXESnkHIGH
mpxfpkvhugnl
mpxfENUMrbykmr
SIMULATEDztd
jmaDYNAMIC_PRIVpirh
nyMULTIrvrcnsme
nyMULTIrvpensme
nyMERGEcCHUNK
nyMERGEgALL_CHUNKS_CONSUMED
nyWRITERzwzsme
nyWRITERzwd
nySORTINGyust
nySORTINGyuWAIT
nyrvrcnsme
nysvfHASxhCOLS
nysvrl
nysvuzmz
nyrvd
nyrvnsusrr
nyrvCOULDNT_RESOLVEzr
wxmgoycvj
kEXECUTEpitp
nksonrBY_MODIFIER_BRANCHES
jmamztbofREPLACEMENT
QUALIFYpwnnnb
eplngyi
SPECIFICojpj
lozmiuhqoAUTOMATIC_TAGGEDttminvunya
miuhTAGminvya
oovhgNULLABLE
oojvhmrgNULLABLE
oovhunpr
oovhunprj
ootfmj
ooxcmlsx
ooxcOOMsx
oojxcROUNDING
ooxcPRECISIONrqoc
oorqMIN
oorqqs
oojrqMIN_TRUNCATING
oojrqqsTRUNCATING
ooREALunNAN
oorttcnj
ooxtnw
oojts
ookvkrx
oorlPRINCIPALsx
ooAWSzesx
ooCSVzzsx
oomcnlsx
oomcqssx
ooqzmh
ooruxcqksx
oorxnkpx
oorlPRINCIPAL_BUCKETsx
ooofwnox
ooprns
oopmns
oosiocDEPTHrqqs
oosisynl
oosiENUMkvkqz
oosiENUMnl
oosinzkvk
oosinsENDS_UNEXPECTEDLY
oosinsossl
oosicUNION
oosicBLOCKpo
oosicBLOCKyysp
oonwsyofMAGIC_BYTES
oosisyugsx
oosisyofoc
oosiofCODECpisy
oosicndpioc
oosiDECODINGsx
oorusrUTF8nsENC
ooruocnl
ooruqunrporqqs
oorukLOCATE_OFFSET
oorunzkvk
oorukLOCATEoc
oosqNUMvhnl
ooOOM
oojsqSKIPPED_LINES
oojsqSKIPPEDwn
oosqnsHASofos
oosqofos
oosqofwn
oojsqtvnpvhNAMES
oorukpesy
oosqjGOTpn
oosikwqsy
oorulrcns
oonkzvmjsx
oonkzvqusx
TABLESAMPLE_PERCENTAGE 2202H
TABLESAMPLEpltaBASEqv
!batomurttcnj
RESULTpoqdph
oumfINTERNAL
oumfCONCURRENCYqd
oumfRUNTIME
oumfTIMEZONE
oumfKEYWORD
oumfozovoq
oumfmhnz
oumfqk
jsspfPARTIALLYue
tzzogmqWITHINssORvgORrk
oomxzz
mzkyonp
hPREFIXnfge
jmasrSTANDARDnf
wyofzdmuxk
ojpjofPROXYrh
ojpjofPROXY
oonmosojme
nyrvZSTDd
nyqtd
oocmxnsnwoc
oosqmxcoc
oomxnsnwjsqoc
srSCALARsbASnf
ornzAGG
osorngwa
rqwaqsDIMENSIONS
qowaqk
!bavvmhmusc
TPksmMTLngDL
xernskHANDOFF_BUSY
@6400
rwOFFLINEnvqh
!barwOFFLINEnvnm
oonqofosox
oonqnswqsx
oonqENCODINGsx
oonqnsnznlsx
oonqocsx
oomcmzATTRsx
oonqOBJpesx
ooofSEGMENTSnc
oonqnsnkzv
phqsREGULARpfysqd
snANALYZEmxnwqnge 0A000
srDML_DYNAMICvo
DEPRECATEsrCOMPOSABLEpbmz
nymxc
nyBLOBnkvf
ofsfPLANox
ooCPnksoCHANGES
ooCPgENABLED
ooCPofwaye
ooCPofvunv
!baooCPmrwnnv
ooCPxbme
oonqcou
oowanksoENTRIES
nyqtpaENCLOSED_BYow
CMD_NEED_SUPER_ORmwultqov
swrs
cswpiCONTEXT
cswCOMBINATION
jREDACTED_PRIVILEGES
cOUTERtq
LIBRARIESge
oojSUMMARY
oojsqtvnpDELIMITERS
LIBRARYc
kPERSISTnaISOLATION
oosicyy
oocmjpiwa
oojwaLOSSYqk
oonqTRUNCATIONd
oonqPAGE_CHUNKj
oonqnksoCHUNKS
ojpjFIREWALL 28000
ooDECOMPRESSIONsx
nucmdmbwz
nuALGO_TEMPTABLEge
nungppobge
nucmdsrSIMPLEodge
nucmdCTEge
nucmdGROUPBYge
nucmdnnnbge
nucmdqdge
nucmdORDERBYge
nucmdMULTIqvge
nucmdofWHEREtipiSUBOBJECT
nucmdWHEREtipiROOTOBJECT
nucmdmbWHEREnwoaSUBOBJECT
nucmdmboinz
nucmdCONTEXT_PREPAREme
nucmdofmxszpiROOT
nucmdMUSTBEmxszoaSINGLETON
nucmdMUSTBEmxszoayw
nucmdofmxOBJpiARRAYAGG
nucmdRELATIONSHIP_RULES_VIOLATED
nucmdmcnzge
nucmdsrBASEfge
nucmdfpwPKox
nucmdfpwPK_PROJECTIONox
nucmdIDnfsbBYgROOTf
nucmdIDnfgsbBY_ROOTf
nucfwzoaSINGLETON_OBJ
nucfwzoaywOBJ
nucmdpmKEYSge
nucmdpmmcge
nucmdwhfqcPROJECTION
nucmdmctxge
nucmdqcfoipiTHEsz
nucmdWHERE_USESsrIMMEDIATExk
nucmdCOMPOSITEnfsb
nucmdALIASgsboawhqv
numtge 0A000
nuoeOR_REPLACEge
nucmxDUALITYszUSAGE
nupamxnz
nutpnfsayoPROVIDED
nuJOINtigSATISFIED
nuPK_DUPLICATESgIDENTICAL
nuUNMAPPEDnf
numruwTAG
numrycSUBOBJECT
nuJOINtiVIOLATION
numrETAG
nuETAGnl
numrmj
nuPK_UPDATESgmq
numromTAG
numruqTAG
nurbuwmj
nuuwmjgFIXED
nurbommj
nuommjgFIXED
!banuufEDITIONqd
nukyosbng
nuDMLwe
!banumrmjoaAGmc
nucBINARYnzsy
ETAGge
mzqiuc
vvnwge
vvfcob
vvfmzge
vvfmzgwv
ooofwnoxofzansPRIV
oovhndmr
oovhndpm
oonqOCI_GENAIon
oonqujnswqsx
nuEXPLICITqjtmgmq
oosqvhndnl
ooDELTAocnl
ooDELTAugped
ooDELTAmhd
jACCOUNT_TRIMMED
oojxtpbybtv
ooGENCOLd
TEMPORALnbui 22008
oosqmcqssx
ooEXTRAthpins
ooruCOMPLEXqk
mmmnpq
mmmnmfmxqezzd
mmmnmeqorcqv
mmmnmeqorcf
mmmnmfmxqendkyopr
mmmnmfnmndcow
mmmnofpdzu
mmmnmfkpems
mmmnmfzrndcow
mmmnmfmxnmndkyopr
mmmnmfpdIDrjmjunc
mmmnmfrkcpgnz
mmmnmfrkcpgsp
mmmnABORT
mmmnCOULDgRELOADvm
mmmnrkcpgrb
mmmnqspoCLOSEqoyztapo
mmmnqspotuPRUNE_SECONDS_PRECEDENCE
mmmnmsHASgBEENoz
mmmncfmd
mmmnmfqemeqoyefFLDS
mmmnmfqemeqozsfoape
mmmnmfqemeqouqFROMf
mmmnmxqesugrrnm
ooCUSTOMosPLACEMENT_OVERRIDES
oosiwnosnznl
mmmnmfcqeABORT
mmmnmfmxcqekyosb
jmmmnvmc
nunctuEXPLICIT_PKSgmq
psqgmfd
psqgronh 42000
psqgEXPECTS_CASE 42000
psqgEXPECTS_CASEtt 42000
psqgmrELSE 42000
psqgONEttvz 42000
psqgsaRETURNpg 42000
psqgcGATEKEEPER 42000
psqgsrLITERAL_GATEKEEPER_ARG 42000
psqgvlCONSTRUCT 42000
psqgcmctq 42000
psqgormcuf 42000
psqgorTYPES 42000
psqgsrDETERMINISTICtk 42000
wyqsqvpiCASCADE_CHAINph
wyCASCADExnUPDATINGwythge
lomsbfpiwyCASCADE
jozOPERATIONSyq
nupacmj
@6900
zjmlqyqn
zjqyWORKERsprttcnj
zjqyWORKERspploaCSA
CSAmhUNTIL_COND
zjqyogMEMORYqdploaCSA
jzjqyogMEMORYqdrttcnj
CSAzjDELAYEDqyge
CSAzjREQUIREMENTqunw
CSAzjREQUIREMENTmipl
xskwupwi
mgIDENTITYuc
nyrvvpunDIRECTORY
numcTAGgeoayf
nuommcTAGgeoaPK`
