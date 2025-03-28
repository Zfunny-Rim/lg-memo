define(["jquery", "qlik", "./cryptoJs.min"], function ($, qlik, CryptoJS) {
	// 유틸 함수: Qlik 변수 가져오기
	function getVariableContent(name) {
		const app = qlik.currApp();
		console.log(name);
		const promise = new Promise((resolve, reject) => {
			app.variable.getByName(name).then((variableModel) => {
				if (!variableModel || !variableModel.id) {
					reject(new Error("Variable not found: " + name));
					return;
				}

				variableModel.getLayout().then((layout) => {
					console.log("layout :", layout);
					if (layout?.qText != null){
						resolve(layout.qText);
					} else {
						reject(new Error("Variable has no calculated value: " + name));
					}
				}).catch((err) => {
					reject(new Error(`getLayout() failed: ${err.message}`));
				});

			}).catch((err) => {
				reject(new Error(`getByName() failed: ${err.message}`));
			});
		});
		
		return promise;
	}

	// 암호화
	function encryptAES(text, key16) {
		const key = CryptoJS.enc.Utf8.parse(key16);
		const iv = CryptoJS.enc.Utf8.parse(key16.substring(0, 16));
		const encrypted = CryptoJS.AES.encrypt(text, key, {
			iv: iv,
			mode: CryptoJS.mode.CBC,
			padding: CryptoJS.pad.Pkcs7
		});
		return encrypted.toString();
	}

	// 복호화
	function decryptAES(encryptedText, key16) {
		const key = CryptoJS.enc.Utf8.parse(key16);
		const iv = CryptoJS.enc.Utf8.parse(key16.substring(0, 16));
		const decrypted = CryptoJS.AES.decrypt(encryptedText, key, {
			iv: iv,
			mode: CryptoJS.mode.CBC,
			padding: CryptoJS.pad.Pkcs7
		});
		return decrypted.toString(CryptoJS.enc.Utf8);
	}
	
	// URL-SAFE Base64
	function toUrlSafeBase64(base64){
		return base64
			.replace(/\+/g, '-')   // '+' → '-'
			.replace(/\//g, '_')   // '/' → '_'
			.replace(/=+$/, '');   // '=' 제거
	}

	// 확장 정의
	return {
		support: {
			snapshot: false,
			export: false,
			exportData: false
		},
		initialProperties: {
			showTitles: false,
			disableNavMenu: true,
			showDetails: false
		},
		definition: {
			type: "items",
			component: "accordion",
			items: {
				appearance: {
					label: "Options",
					type: "items",
					items: {
						actionType: {
							ref: "actionType",
							label: "Action Type",
							type: "string",
							component: "dropdown",
							options: [
								{ value: "issue_note",     label: "Issue Note" },
								{ value: "reliability", label: "Reliability" },
								{ value: "qcost_create",     label: "Create Quality Cost" },
								{ value: "qcost_update",     label: "Update Quality Cost" }
							],
							defaultValue: "issue_note"
						},       
						actionSettings: {
							label: "Custom Setting",
							type: "items",
							items: {
								buttonText: {
									ref: "buttonText",
									label: "Button Text",
									type: "string",
									defaultValue: "Button"
								},
								customCss: {
									ref: "customCss",
									label: "Button CSS",
									type: "string",
									expression: "optional",
									defaultValue: "width: 100%;height: 100%;cursor: pointer;color: #e34975;font-weight: bold;background-color: #fefafd;border: 0.135px solid #e34975;padding: 6px 14px;border-radius: 4px;font-size: 12px;"
								},
								serverAddress: {
									ref: "serverAddress",
									label: "Server Address",
									type: "string",
									expression: "optional",
									defaultValue: "https://cqisdev.lge.com"  
								},
								vAESKeyName: {
									ref: "vAESKeyName",
									label: "vAESKey Variable Name",
									type: "string",
									defaultValue: "vAESKey"
								},
								vSearchVarName: {
									ref: "vSearchVarName",
									label: "vSearch Variable Name",
									type: "string",
									defaultValue: "vSearch"
								}
							}
						}
					}
				}
			}
		},
		paint: async function ($element, layout) {
			const ownId = this.options.id;
			const customCss = layout.customCss || "width: 100%;height: 100%;cursor: pointer;color: #e34975;font-weight: bold;background-color: #fefafd;border: 0.135px solid #e34975;padding: 6px 14px;border-radius: 4px;font-size: 12px;";
			const btnText = layout.buttonText || "LG";
			const $button = $("<button>", {
				id: ownId + "-btn",
				text: btnText,
				style: customCss
			});
			$element.empty().append($button);

			// 스타일 삽입
			$("#" + ownId).remove();
			const style = `
				div[tid="${ownId}"] .qv-object-${ownId},
				div[tid="${ownId}"] .qv-inner-object:not(.visual-cue) {
					border: none!important;
					background: none!important;
					margin: 0!important;
					padding: 0!important;
				}
				#${ownId}_title {
					display: none!important;
				}
			`;
			$("<style>", { id: ownId }).html(style).appendTo("head");

			// 클릭 이벤트
			$button.on('click', async function () {
				const app = qlik.currApp();
				const mode = qlik.navigation.getMode();
				if (mode === "edit") return;

				try {
					const [vAESKey, vSearch] = await Promise.all([
						getVariableContent(layout.vAESKeyName),
						getVariableContent(layout.vSearchVarName)
					]);
					
					
					console.log("server Address : " + layout.serverAddress);
					console.log("actionType : " + layout.actionType);
					var endpoint = "";
					switch(layout.actionType){
						case "issue_note":
							endpoint = "/qlik/issue/detail/?search="
							break;
						case "reliability":
							endpoint = "/qlik/reliability/detail/?search="
							break;
						case "qcost_create":
							endpoint = "/qlik/memo/create?search="
							break;
						case "qcost_update":
							endpoint = "/qlik/memo/modify?search="
							break;
					}
					console.log("endpoint : " + endpoint);
					const encrypted = encryptAES(vSearch, vAESKey);
					console.log("Encrypted: " + encrypted);
					//const encoded = encodeURIComponent(encrypted);
					const encoded = toUrlSafeBase64(encrypted);
					console.log("Encoded: " + encoded);
					const apiUri = layout.serverAddress + endpoint + encoded;
					console.log("** API URI: "+apiUri+" ** ");
					
					const decrypted = decryptAES(encrypted, vAESKey);
					console.log("Decrypted: " + decrypted);
					
					//alert(apiUri);
					const popupWidth = 1280;
					const popupHeight = 860;

					const left = window.screenX + (window.outerWidth - popupWidth) / 2;
					const top = window.screenY + (window.outerHeight - popupHeight) / 2;

					const features = [
						`width=${popupWidth}`,
						`height=${popupHeight}`,
						`left=${left}`,
						`top=${top}`,
						"toolbar=no",
						"menubar=no",
						"scrollbars=yes",
						"resizable=yes",
						"status=no"
					].join(",");
					window.open(apiUri, "_blank", features);

					//To-do List...
					// - json 구조 검증
					// - 필수 데이터 검증
					// - 각 option 당 windows 사이즈 개별 지정
					// - vAESKey, vSearch 변수 에러 처리
					// - 테스트

				} catch (err) {
					console.error("Variable fetch or encryption failed:", err);
				}
			});

			return qlik.Promise.resolve();
		}
	};
});
