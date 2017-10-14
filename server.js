"use strict";

var http = require("http");
var url = require("url");
var fs = require("fs");
var path = require("path");

// load and index the catalog:
var catalog = require("./catalog.js");
catalog.categories.allItems = {};
for(var c in catalog.categories) if (c.length === 2) {
	catalog.categories[c].items.forEach(function (it) { catalog.categories.allItems[it.r] = it; });
}

var host = process.env.OPENSHIFT_BUILD_NAMESPACE ? "0.0.0.0" : "127.0.0.1";
var port = process.env.OPENSHIFT_BUILD_NAMESPACE ?  8080 : 8080;
var appPath = "/555";
var secret = "6789974";
var dataDir = process.env.OPENSHIFT_BUILD_NAMESPACE ? "/shoppystore" : "./shoppystore";

var appRootDir = ".";
var publicDir = appRootDir + "/public";
var rootCategoryDir = appRootDir + "/public/catalog";
var dbprefix = dataDir + "/db-";

var photoThumb = "http://dojoseibukan.free.fr/shop/thumb/";
var photoLarge = "http://dojoseibukan.free.fr/shop/large/";

var orderCntr = readOrderCntr();

var mimeTypes = {
    "html": "text/html",
    "js": "text/javascript",
    "css": "text/css",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "JPG": "image/jpeg",
    "png": "image/png"
};

// General utilities

function encodeObjectForCookie(object) {
	var json = JSON.stringify(object);
	var json64 = new Buffer(json).toString('base64');
	return json64;
}

function decodeObjectFromCookie(json64) {
	if (json64 === undefined) return null;
	var json = new Buffer(json64, 'base64').toString('utf8');
	return JSON.parse(json);
}

function cookieAssignForObject(cookieName, object) {
	return cookieName + "=" + encodeObjectForCookie(object) + "; Path=/";
}

function parseCookies(request) {
	// http://stackoverflow.com/questions/3393854/get-and-set-a-single-cookie-with-node-js-http-server
    var r = {};
    var rc = request.headers.cookie;
    rc && rc.split(';').forEach(function(cookie) {
        var parts = cookie.split('=');
        r[parts.shift().trim()] = unescape(parts.join('='));
    });
	request.parsedCookies = r;
    return r;
}

function getObjectFromCookie(cookieName, request) {
	var json64 = request.parsedCookies[cookieName];
	return decodeObjectFromCookie(json64) ;
}

function getBasketFromCookie(request) {
	var json64 = request.parsedCookies.basket;
	if (json64 === undefined) return { items: [] };
	return decodeObjectFromCookie(json64);
}

function respondError(errorCode, response) {
	response.writeHead(errorCode, {"Content-Type": "text/plain"});
	response.end(errorCode + ": " +http.STATUS_CODES[errorCode]);
}

function respondRedirect(uri, response) {
	response.writeHead(303, {"Location": uri});
	response.end();
}

// utilities

function htmlBegin(response, cssClass) {
	response.writeHead(200, {
		"Content-Type": "text/html; charset=utf-8",
		"Last-Modified": new Date().toUTCString()
	});
	response.write("<!DOCTYPE html>");
	response.write("<html><head><title>Dojo Plouzané</title>");
	response.write("<meta http-equiv='Content-Type' content='text/html;charset=utf-8'>");
	response.write("<meta http-equiv='Cache-Control' content='no-cache, no-store, must-revalidate'>");
	response.write("<meta http-equiv='Pragma' content='no-cache'");
	response.write("<meta http-equiv='Expires' content='0'>");
	response.write("<link rel='stylesheet' type='text/css' href='" + appPath + "/style.css'></head><body class='" + cssClass + "'>");
}

function htmlEnd(response) {
	response.write("</body></html>");
	response.end();
}

function condLink(link, title, icon, explain, cond, response) {
	if (cond) response.write(" <a href='" + link + "' title = '" + explain + "'>");
	response.write("<img src='" + appPath + "/" + icon + "'>" + title);
	if (cond) response.write("</a>");
}

function printMenu(response, showHome, showBasket) {
	response.write("<div class='menu'>\n");
	condLink(appPath + "/", "Accueil", "home.png", "Retourner à la page d\'accueil", showHome, response);
	condLink(appPath + "/panier/contenu", "Panier", "cart.png", "Afficher le contenu du panier", showBasket, response);
	response.write("</div>\n");
}

function getPrice(articleId) {
	return catalog.categories.allItems[articleId].p;
}

function computeItemsPrice(articleIds) {
	return articleIds.reduce(function (a, e) { return a + getPrice(e); }, 0.0);
}

function computeReduction(total) {
	return total > 8 ? (total - 8) / 2 : 0;
}

function computeFinalPrice(articleIds) {
	var p = computeItemsPrice(articleIds);
	return p - computeReduction(p);
}

function recordOrder(order) {
	fs.appendFile(dbprefix + "orders.json", JSON.stringify(order) + ",\n");
	fs.appendFile(dbprefix + "orders.csv",
		order.n + ","
		+ order.d + ","
		+ order.fn + ","
		+ order.ln + ","
		+ order.em + ","
		+ order.p + ","
		+ order.items + "\r\n");
}

function showArticle(articleId, dim, response, add, remove) {
	response.write("<div class='item'>");
	response.write("<a target='_blank' href='" + photoLarge + articleId + ".JPG'>");
	response.write("<img src='");
	response.write(photoThumb + articleId + ".JPG'");
	if (dim) response.write(" height='" + dim + "'");
	response.write(" title='Cliquer pour agrandir'");
	response.write(">");
	response.write("</a>");
	response.write("<br>");
	response.write(articleId);
	response.write("<br>");
	if (add) {
		response.write("<a href='" + appPath + "/panier/ajouter/");
		response.write(articleId);
		response.write("'><img src='" + appPath + "/cart.png' width='22' title='Ajouter au panier'></a>");
	}
	if (remove) {
		response.write("<a href='" + appPath + "/panier/supprimer/");
		response.write(articleId);
		response.write("'><img src='" + appPath + "/delete.gif' width='20' title='Supprimer du panier'></a>");
	}
	response.write("&nbsp;" + getPrice(articleId) + " &#x20AC;");
	response.write("</div>");
}

function readOrderCntr() {
	try {
		return parseFloat(fs.readFileSync(dbprefix + "cntr", "UTF-8"));
	} catch (e) {
		return 300;
	}
}

// Service methods

function getCategory(categoryPath, response) {
	response.setHeader("Set-Cookie", "last=" + categoryPath + "; Path=/");
	var category = catalog.categories[categoryPath];
	htmlBegin(response, "select-page");
	printMenu(response, true, true);
	response.write("<h1>" + category.name + "</h1>");
	response.write("<div class='items'>");
	if (category.items.length === 0) {
		response.write("Cette catégorie ne contient pas d'articles.");
	}
	category.items.forEach(function (i) {
		showArticle(i.r, null, response, true, false);
	});
	response.write("</div>");
	htmlEnd(response);
}

function getAddToBasket(basket, articleId, response) {
	basket.items.push(articleId);
	response.setHeader("Set-Cookie", cookieAssignForObject("basket", basket));
    respondRedirect(appPath + "/panier/contenu", response);
}

function getRemoveFromBasket(basket, articleId, response) {
	var i = basket.items.indexOf(articleId);
	if (i > -1) {
		basket.items.splice(i, 1);
		response.setHeader("Set-Cookie", cookieAssignForObject("basket", basket));
	}
    respondRedirect(appPath + "/panier/contenu", response);
}

function serveBasket(request, response) {
	var basket = getBasketFromCookie(request);
	htmlBegin(response, "order-page");
	printMenu(response, true, false);
	var n = basket.items.length;
	var p0 = computeItemsPrice(basket.items);
	var r = computeReduction(p0);
	var p = computeFinalPrice(basket.items);
	response.write("<h1>Panier :</h1>");
    response.write("<p><b>Votre panier contient " + n + " article" + (n > 1 ? "s" : "") + ".</b>");
	if (r !== 0) {
		response.write("<p>Prix des articles : " + p0 + " &#x20AC;");
		response.write("<br>Réduction : " + r + " &#x20AC;");
	}
	response.write("<br><b>Total à règler : " + p + " &#x20AC;</b>");
	response.write("<p><div class='items'>");
	basket.items.forEach(function (articleId) { showArticle(articleId, null, response, false, true); });
	response.write("</div><p>");
	var lastAddr = request.parsedCookies.last ? appPath + "/catalog/" + request.parsedCookies.last : appPath + "/";
	response.write("<a class='button' href='" + lastAddr + "'>Continuer</a> <span class ='explain'>Cliquez ici pour revenir à la dernière catégorie de photos</span>");
	if (n > 0) {
		response.write("<form action='" + appPath + "/panier/saisieCoordonnees' method='get'><input class='orange' type='submit' value='Passer la commande'> <span class ='explain'>Cliquez ici pour passer la commande ; la confirmation se fait à la page suivante</span></form>");
	}
	htmlEnd(response);
}

function serveOrderForm(request, query, response) {
	var basket = getBasketFromCookie(request);
	htmlBegin(response, "order-page");
	var n = basket.items.length;
	var p = computeFinalPrice(basket.items);
	if (p < 4) {
		response.write("<p>La commande minimale est de 4 &#x20AC;.");
	} else if (n === 0) {
		response.write("<p>Le panier est vide.");
	} else {
		response.write("<p>Vous allez commander les " + n + " article" + (n > 1 ? "s" : "") + " suivants :");
		response.write("<div class='items'>");
		basket.items.forEach(function (articleId) { showArticle(articleId, "120", response, false, false); });
		response.write("</div>");
		response.write("<p><b>Total à règler : " + p + " &#x20AC;</b>");
		if (query.err == 1) response.write("<p><b>Tous les champs doivent être remplis :</b>");
		response.write("<form action='" + appPath + "/panier/traiterCommande' method='get'><p>Nom : <input name='ln' type='text' value=''><br>Prénom : <input name='fn' type='text' value=''><br>E-mail : <input name='em' type='text' value=''><br><input class='orange' type='submit' value='Confirmer la commande'> <span class ='explain'>En cliquant ce bouton, vous passez commande des articles listés ci-dessus et vous vous engagez à régler la somme correspondante. Cette action est définitive. Un récapitulatif vous sera fourni à l'étape suivante.</span></form>");
	}
	response.write("<p><a class = 'button' href='" + appPath + "/panier/contenu'>Retour au panier</a>");
	response.write("<p><a class = 'button' href='" + appPath + "/'>Retour à l'accueil</a>");
	htmlEnd(response);
}

function serveOrderProcess(request, query, response) {
	var basket = getBasketFromCookie(request);
	if (basket.items.length === 0) {
		respondRedirect(appPath + "/panier/contenu", response);
		return;
	}
	if (query.fn.length == 0 || query.ln.length == 0 || query.em.length == 0) {
		respondRedirect(appPath + "/panier/saisieCoordonnees?err=1", response);
		return;
	}
	// generate order number:
	orderCntr++;
	fs.writeFileSync(dbprefix + "cntr", orderCntr.toString(), "UTF-8");
	// append to order file:
	var order = {
		n: orderCntr, d: new Date().toISOString(),
		fn: query.fn, ln: query.ln, em: query.em,
		items: basket.items, p: computeFinalPrice(basket.items)};
	recordOrder(order);
	// send confirmation email:

	// clear basket and respond:
	basket.items = [];
	response.setHeader("Set-Cookie", [cookieAssignForObject("basket", basket), cookieAssignForObject("order", order)]);
	respondRedirect(appPath + "/panier/confirmationCommande", response);
}

function serveOrderConfirmation(request, response) {
	var order = getObjectFromCookie("order", request);
	htmlBegin(response, "order-page");
	response.write("<p><b>Votre commande a été enregistrée sous le numéro " + order.n + "</b><br><span class='explain'>Merci de noter ce numéro, il sera utile pour le retrait des photos<span>");
	response.write("<p><b>Total à règler : " + order.p + " &#x20AC;</b><br> </b><span class='explain'>Le paiement doit se faire au dojo dès le prochain cours, <u>sous enveloppe mentionant nom et numéro de commande</u>.<span>");
	response.write("<div class='items'>");
	order.items.forEach(function (articleId) { showArticle(articleId, "120", response, false, false); });
	response.write("</div>");
	response.write("<p><a class = 'button' href='" + appPath + "/'>Retour à l'accueil</a>");
	htmlEnd(response);
}

function getFile(request, response, filename) {
	console.log("  > serve file " + filename);
	var stats;
    try {
        stats = fs.lstatSync(filename);
    } catch (e) {
		respondError(404, response);
        return;
    }
    if (stats.isFile()) {
		var mtime = stats.mtime;
		var reqModDate = request.headers["if-modified-since"];
		if (reqModDate !== null && new Date(reqModDate).getTime() == mtime.getTime()) {
			console.log("  > not modified");
			response.writeHead(304, {"Last-Modified": mtime.toUTCString()});
			response.end();
			return true;
		}
        var mimeType = mimeTypes[path.extname(filename).split(".")[1]];
        response.writeHead(200, {"Content-Type": mimeType, "Last-Modified": mtime.toUTCString()});
        var fileStream = fs.createReadStream(filename);
        fileStream.pipe(response);
    } else if (stats.isDirectory()) {
        respondError(403, response);
    } else {
        respondError(500, response);
    }
}

// Server main function

function serve(request, response) {
    console.log(request.method + " " + request.url);
    var parsedUrl = url.parse(request.url, true);
    function match(prefix) {
        var l = prefix.length;
        if (parsedUrl.pathname.length >= l && parsedUrl.pathname.substring(0, l) === prefix) {
            parsedUrl.subpath = parsedUrl.pathname.substring(l);
            return true;
        }
        return false;
    }
    try {
		switch (request.method) {
		case "GET":
			if (match(appPath + "/catalog/")) {
				getCategory(parsedUrl.subpath, response);
			} else if (match(appPath + "/panier/")) {
				parseCookies(request);
				if (parsedUrl.pathname === appPath + "/panier/contenu") {
					serveBasket(request, response);
				} else if (match(appPath + "/panier/ajouter/")) {
					getAddToBasket(getBasketFromCookie(request), parsedUrl.subpath, response);
				} else if (match(appPath + "/panier/supprimer/")) {
					getRemoveFromBasket(getBasketFromCookie(request), parsedUrl.subpath, response);
				} else if (parsedUrl.pathname === appPath + "/panier/saisieCoordonnees") {
					serveOrderForm(request, parsedUrl.query, response);
				} else if (match(appPath + "/panier/traiterCommande")) {
					serveOrderProcess(request, parsedUrl.query, response);
				} else if (match(appPath + "/panier/confirmationCommande")) {
					serveOrderConfirmation(request, response);
				}
			} else if (match(appPath + "/" + secret + "/")) {
				getFile(request, response, dataDir + "/" + parsedUrl.subpath);
			} else if (parsedUrl.pathname === appPath || parsedUrl.pathname === appPath + "/") {
				respondRedirect(appPath + "/index.html", response);
			} else if (match(appPath + "/")) {
				getFile(request, response, publicDir + "/" + parsedUrl.subpath);
			} else {
				respondError(404, response);
			}
			break;
		case "POST":
			if (match(appPath + "/action/")) {
			} else {
			}
			break;
		}
    } catch (e) {
        respondError(500, response);
    }
}

http.createServer(serve).listen(port, host);
console.log("started");
console.log("http://" + host + ":" + port + appPath);
