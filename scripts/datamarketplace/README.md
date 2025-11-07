# Datamarketplace Deployment Scripts

Scripts de déploiement et gestion pour les contrats du datamarketplace utilisant le pattern EIP-1167 factory.

## 📁 Structure des Scripts

```
scripts/datamarketplace/
├── deploy-implementations.ts    # Déploie les contrats d'implémentation (étape 1)
├── deploy-managers.ts          # Déploie GraduationManager et BurnPortal (étape 2)
├── deploy-factory.ts           # Déploie DatasetFactory (étape 3)
├── deploy-complete-system.ts   # Déploiement complet orchestré (recommandé)
├── verify-contracts.ts         # Vérification sur block explorer
├── test-deployment.ts          # Test de fonctionnement du système
└── README.md                   # Ce fichier
```

## 🚀 Ordre de Déploiement

### Option 1: Déploiement Complet (Recommandé)

```bash
# Déploie tout le système en une fois
npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network baseSepolia
npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network base
```

### Option 2: Déploiement Étape par Étape

```bash
# 1. Déployer les implémentations
npx hardhat run scripts/datamarketplace/deploy-implementations.ts --network baseSepolia

# 2. Déployer les managers
npx hardhat run scripts/datamarketplace/deploy-managers.ts --network baseSepolia

# 3. Déployer la factory
npx hardhat run scripts/datamarketplace/deploy-factory.ts --network baseSepolia
```

## 📋 Pré-requis

### Variables d'Environnement

Créer un fichier `.env` avec :

```bash
# Clé privée du déployeur
PRIVATE_KEY=your_private_key_here

# URLs RPC
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_RPC_URL=https://mainnet.base.org

# API Key pour vérification
ETHERSCAN_API_KEY=your_basescan_api_key

# Adresses optionnelles (utilise le déployeur par défaut si non spécifiées)
PROTOCOL_FEE_RECIPIENT=0x...
TIMELOCK_ADDRESS=0x...
GUARDIAN_ADDRESS=0x...
```

### Tokens Requis

**Pour tester :** Le déployeur doit avoir des tokens CLONES pour payer les frais de lancement.

**Adresses des tokens CLONES :**
- Base Mainnet: `0xaadd98Ad4660008C917C6FE7286Bc54b2eEF894d`
- Base Sepolia: `0x15eB86c7E54B350bf936d916Df33AEF697202E29`

## 🔧 Scripts Détaillés

### 1. deploy-implementations.ts

Déploie les contrats maîtres pour le pattern EIP-1167 :
- `DatasetTokenImplementation.sol`
- `BondingCurveImplementation.sol`

**Usage :**
```bash
npx hardhat run scripts/datamarketplace/deploy-implementations.ts --network baseSepolia
```

**Output :** Sauvegarde les adresses dans `deployments/{network}.json`

### 2. deploy-managers.ts

Déploie les contrats de gestion :
- `GraduationManager.sol` - Gère la graduation vers Uniswap V2
- `BurnPortal.sol` - Gère le burn-to-download

**Configuration automatique :**
- Base Mainnet : Adresses Uniswap V2 réelles
- Base Sepolia : Adresses de test

**Usage :**
```bash
npx hardhat run scripts/datamarketplace/deploy-managers.ts --network baseSepolia
```

### 3. deploy-factory.ts

Déploie la factory principale `DatasetFactory.sol`.

**Pré-requis :** Les implémentations doivent être déployées.

**Paramètres configurés :**
- Frais de lancement : 100 CLONES (~$50)
- Liquidité min : 0.01 ETH
- Liquidité max : 100 ETH

**Usage :**
```bash
npx hardhat run scripts/datamarketplace/deploy-factory.ts --network baseSepolia
```

### 4. deploy-complete-system.ts

Orchestration complète qui :
1. Déploie toutes les implémentations
2. Déploie les managers
3. Déploie la factory
4. Configure les interconnexions
5. Teste la configuration

**Usage :**
```bash
npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network baseSepolia
```

**Avantages :**
- Déploiement atomique
- Configuration automatique
- Validation post-déploiement

### 5. verify-contracts.ts

Vérifie tous les contrats sur Basescan.

**Pré-requis :** `ETHERSCAN_API_KEY` configurée.

**Usage :**
```bash
npx hardhat run scripts/datamarketplace/verify-contracts.ts --network baseSepolia
```

**Fonctionnalités :**
- Lit les arguments depuis le registre
- Gère les contrats déjà vérifiés
- Affiche les liens block explorer

### 6. test-deployment.ts

Test end-to-end du système déployé.

**Tests effectués :**
1. ✅ Vérification état factory
2. ✅ Balance et allowance CLONES
3. ✅ Prédiction d'adresses
4. ✅ Création de dataset test
5. ✅ Vérification proxies EIP-1167
6. ✅ Achat de tokens sur bonding curve

**Usage :**
```bash
npx hardhat run scripts/datamarketplace/test-deployment.ts --network baseSepolia
```

## 📊 Système de Registre

Tous les scripts utilisent le système de registre unifié :

```json
{
  "networkName": "base-sepolia",
  "chainId": 84532,
  "timestamp": "2024-01-15T10:30:00Z",
  "deployer": "0x...",
  "configured": true,
  "contracts": {
    "DatasetTokenImplementation": {
      "address": "0x...",
      "txHash": "0x...",
      "args": []
    },
    "DatasetFactory": {
      "address": "0x...",
      "txHash": "0x...",
      "args": ["0x...", "0x...", ...]
    }
  }
}
```

**Localisation :** `deployments/{network}.json`

## 🔍 Vérification Post-Déploiement

### Checklist de Validation

- [ ] Toutes les implémentations déployées
- [ ] Factory configurée avec bonnes implémentations
- [ ] BurnPortal référence la factory
- [ ] GraduationManager configuré
- [ ] Test de création dataset réussi
- [ ] Contrats vérifiés sur Basescan

### Commandes de Diagnostic

```bash
# Vérifier l'état de la factory
npx hardhat console --network baseSepolia
> const factory = await ethers.getContractAt("DatasetFactory", "0x...")
> await factory.getTotalDatasets()

# Vérifier les implémentations
> await factory.DATASET_TOKEN_IMPLEMENTATION()
> await factory.BONDING_CURVE_IMPLEMENTATION()
```

## 🛠 Dépannage

### Erreurs Communes

**1. "Implementation not found"**
```bash
# Solution: Déployer les implémentations d'abord
npx hardhat run scripts/datamarketplace/deploy-implementations.ts --network baseSepolia
```

**2. "Insufficient CLONES balance"**
```bash
# Solution: Obtenir des tokens CLONES de test
# Sur Sepolia, contacter l'équipe pour des tokens de test
```

**3. "Factory address not set in BurnPortal"**
```bash
# Solution: Mettre à jour l'adresse factory
npx hardhat console --network baseSepolia
> const burnPortal = await ethers.getContractAt("BurnPortal", "0x...")
> await burnPortal.updateDatasetFactory("0x...")
```

### Logs et Debug

Activer le debug détaillé :
```bash
DEBUG=* npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network baseSepolia
```

## 🚀 Production Deployment

### Base Mainnet

```bash
# Variables d'environnement production
export PROTOCOL_FEE_RECIPIENT=0x... # Adresse treasury
export TIMELOCK_ADDRESS=0x...      # Adresse multisig timelock
export GUARDIAN_ADDRESS=0x...      # Adresse guardian

# Déploiement production
npx hardhat run scripts/datamarketplace/deploy-complete-system.ts --network base

# Vérification
npx hardhat run scripts/datamarketplace/verify-contracts.ts --network base

# Test système
npx hardhat run scripts/datamarketplace/test-deployment.ts --network base
```

### Sécurité

⚠️ **Important pour la production :**
- Utiliser un multisig comme deployer
- Vérifier toutes les adresses avant déploiement
- Tester sur Sepolia avant mainnet
- Conserver une copie du registre de déploiement
- Documenter toutes les adresses pour l'équipe

## 📞 Support

En cas de problème :
1. Vérifier les logs de déploiement
2. Consulter le registre `deployments/{network}.json`
3. Tester avec `test-deployment.ts`
4. Contacter l'équipe avec les détails d'erreur